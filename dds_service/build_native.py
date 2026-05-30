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


def _find_gpp() -> Path:
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

    raise RuntimeError("Could not find g++.exe required to build DDS native library")


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


def ensure_dds_dll() -> Path:
    with _build_lock:
        BIN_DIR.mkdir(parents=True, exist_ok=True)

        compiler = _find_gpp()
        _copy_runtime_dlls(compiler)

        if not _needs_rebuild(DDS_DLL, DDS_ROOT / "library" / "src"):
            return DDS_DLL

        include_root = DDS_ROOT / "library" / "src"
        sources = sorted(str(path) for path in include_root.rglob("*.cpp"))
        command = [
            str(compiler),
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

        env = os.environ.copy()
        compiler_bin = str(compiler.parent)
        env["PATH"] = compiler_bin + os.pathsep + env.get("PATH", "")

        completed = subprocess.run(
            command,
            cwd=str(WORKSPACE_ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                "Failed to build DDS native library.\n"
                f"stdout:\n{completed.stdout}\n"
                f"stderr:\n{completed.stderr}"
            )

        _copy_runtime_dlls(compiler)
        return DDS_DLL