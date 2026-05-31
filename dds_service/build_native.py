from __future__ import annotations

import os
import shutil
import subprocess
import threading
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
DDS_ROOT = WORKSPACE_ROOT / "public" / "dds"
BUILD_ROOT = WORKSPACE_ROOT / ".dds-build"
BIN_DIR = BUILD_ROOT / "bin"
DDS_DLL = BIN_DIR / "dds.dll"
RUNTIME_DLLS = ("libstdc++-6.dll", "libgcc_s_seh-1.dll", "libwinpthread-1.dll", "libatomic-1.dll")

_build_lock = threading.Lock()


def _find_cpp_compiler() -> tuple[Path, str]:
    candidates = [
        shutil.which("icpx.exe"),
        shutil.which("icpx"),
        r"C:\Program Files (x86)\Intel\oneAPI\compiler\latest\bin\icpx.exe",
        r"C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\bin\icpx.exe",
        shutil.which("g++.exe"),
        shutil.which("g++"),
        r"C:\workspace\soft\msys2\mingw64\bin\g++.exe",
        r"C:\msys64\mingw64\bin\g++.exe",
    ]

    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.exists():
            if path.name.lower().startswith("icpx"):
                return path, "icpx"
            return path, "g++"

    raise RuntimeError("Could not find a supported C++ compiler (icpx or g++) required to build DDS native library")


def _find_gpp_compiler() -> Path:
    candidates = [
        shutil.which("g++.exe"),
        shutil.which("g++"),
        r"C:\workspace\soft\msys2\mingw64\bin\g++.exe",
        r"C:\msys64\mingw64\bin\g++.exe",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.exists():
            return path
    raise RuntimeError("Could not find g++ compiler for fallback build")


def _needs_rebuild(output_path: Path, source_root: Path) -> bool:
    if not output_path.exists():
        return True

    output_mtime = output_path.stat().st_mtime
    for source_path in source_root.rglob("*.cpp"):
        if source_path.stat().st_mtime > output_mtime:
            return True

    for header_path in source_root.rglob("*.h"):
        if header_path.stat().st_mtime > output_mtime:
            return True

    for header_path in source_root.rglob("*.hpp"):
        if header_path.stat().st_mtime > output_mtime:
            return True

    return False


def _copy_runtime_dlls(compiler_path: Path) -> None:
    compiler_dir = compiler_path.parent
    for dll_name in RUNTIME_DLLS:
        source = compiler_dir / dll_name
        target = BIN_DIR / dll_name
        if source.exists() and not target.exists():
            shutil.copy2(source, target)


def _find_icpx_lib_dir(compiler_path: Path) -> Path | None:
    # Typical oneAPI layout: .../compiler/<version>/bin/icpx.exe with libs in ../lib
    candidate = compiler_path.parent.parent / "lib"
    if candidate.exists() and (candidate / "libmmt.lib").exists():
        return candidate
    return None


def ensure_dds_dll() -> Path:
    with _build_lock:
        BIN_DIR.mkdir(parents=True, exist_ok=True)

        compiler, compiler_kind = _find_cpp_compiler()
        if compiler_kind == "g++":
            _copy_runtime_dlls(compiler)

        if not _needs_rebuild(DDS_DLL, DDS_ROOT / "library" / "src"):
            return DDS_DLL

        include_root = DDS_ROOT / "library" / "src"
        sources = sorted(str(path) for path in include_root.rglob("*.cpp"))

        def make_command(kind: str, compiler_path: Path) -> list[str]:
            if kind == "icpx":
                # Prefer Intel oneAPI flags for higher runtime performance on host CPU.
                return [
                    str(compiler_path),
                    "-std=c++20",
                    "-O3",
                    "-xHost",
                    "-ipo",
                    "-ffast-math",
                    "-shared",
                    "-I",
                    str(include_root),
                    "-o",
                    str(DDS_DLL),
                    *sources,
                ]
            return [
                str(compiler_path),
                "-std=c++20",
                "-O2",
                "-shared",
                "-static-libgcc",
                "-static-libstdc++",
                "-I",
                str(include_root),
                "-o",
                str(DDS_DLL),
                *sources,
            ]

        command = make_command(compiler_kind, compiler)

        env = os.environ.copy()
        compiler_bin = str(compiler.parent)
        env["PATH"] = compiler_bin + os.pathsep + env.get("PATH", "")
        if compiler_kind == "icpx":
            lib_dir = _find_icpx_lib_dir(compiler)
            if lib_dir is not None:
                env["LIB"] = str(lib_dir) + os.pathsep + env.get("LIB", "")

        completed = subprocess.run(
            command,
            cwd=str(WORKSPACE_ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        fallback_note = ""
        if completed.returncode != 0 and compiler_kind == "icpx":
            # Allow development outside oneAPI shells: retry with g++.
            fallback = _find_gpp_compiler()
            fallback_env = os.environ.copy()
            fallback_env["PATH"] = str(fallback.parent) + os.pathsep + fallback_env.get("PATH", "")
            completed = subprocess.run(
                make_command("g++", fallback),
                cwd=str(WORKSPACE_ROOT),
                env=fallback_env,
                capture_output=True,
                text=True,
                check=False,
            )
            if completed.returncode == 0:
                compiler = fallback
                compiler_kind = "g++"
                _copy_runtime_dlls(compiler)
                fallback_note = "\nNote: icpx build failed; successfully fell back to g++."

        if completed.returncode != 0:
            raise RuntimeError(
                "Failed to build DDS native library.\n"
                f"stdout:\n{completed.stdout}\n"
                f"stderr:\n{completed.stderr}{fallback_note}"
            )

        if compiler_kind == "g++":
            _copy_runtime_dlls(compiler)
        return DDS_DLL