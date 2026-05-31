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
ICPX_RUNTIME_DLLS = ("libiomp5md.dll", "libmmd.dll", "libircmd.dll", "svml_dispmd.dll")
TBB_RUNTIME_DLLS = ("tbb12.dll", "tbbbind_2_5.dll", "tbbmalloc.dll", "tbbmalloc_proxy.dll", "libhwloc-15.dll")

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


def _find_icpx_compiler() -> Path:
    candidates = [
        shutil.which("icpx.exe"),
        shutil.which("icpx"),
        r"C:\Program Files (x86)\Intel\oneAPI\compiler\latest\bin\icpx.exe",
        r"C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\bin\icpx.exe",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.exists():
            return path
    raise RuntimeError("Could not find Intel oneAPI icpx compiler")


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


def _copy_runtime_dlls(dll_names: tuple[str, ...], source_dir: Path) -> None:
    for dll_name in dll_names:
        source = source_dir / dll_name
        target = BIN_DIR / dll_name
        if source.exists() and not target.exists():
            shutil.copy2(source, target)


def _find_icpx_lib_dir(compiler_path: Path) -> Path | None:
    # Typical oneAPI layout: .../compiler/<version>/bin/icpx.exe with libs in ../lib
    candidate = compiler_path.parent.parent / "lib"
    if candidate.exists() and (candidate / "libmmt.lib").exists():
        return candidate
    return None


def _find_oneapi_root(compiler_path: Path) -> Path | None:
    # icpx: ...\oneAPI\compiler\<version>\bin\icpx.exe
    compiler_version_dir = compiler_path.parent.parent
    compiler_pkg_dir = compiler_version_dir.parent
    root = compiler_pkg_dir.parent
    if root.exists() and root.name.lower() == "oneapi":
        return root
    return None


def _find_onetbb_include_dir() -> Path | None:
    candidates = [
        Path(r"C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\include"),
        Path(r"C:\Program Files (x86)\Intel\oneAPI\2025.3\include"),
        Path(r"C:\Program Files (x86)\Intel\oneAPI\tbb\2022.3\include"),
    ]
    for candidate in candidates:
        if (candidate / "tbb" / "parallel_for.h").exists():
            return candidate
    return None


def _find_onetbb_lib_dir() -> Path | None:
    candidates = [
        Path(r"C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\lib"),
        Path(r"C:\Program Files (x86)\Intel\oneAPI\2025.3\lib"),
        Path(r"C:\Program Files (x86)\Intel\oneAPI\tbb\2022.3\lib"),
    ]
    for candidate in candidates:
        if (candidate / "tbb12.lib").exists():
            return candidate
    return None


def _find_onetbb_bin_dir() -> Path | None:
    candidates = [
        Path(r"C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\bin"),
        Path(r"C:\Program Files (x86)\Intel\oneAPI\2025.3\bin"),
        Path(r"C:\Program Files (x86)\Intel\oneAPI\tbb\2022.3\bin"),
    ]
    for candidate in candidates:
        if (candidate / "tbb12.dll").exists():
            return candidate
    return None


def _find_msvc_x64_lib_dir() -> Path | None:
    roots = [
        Path(r"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC"),
        Path(r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC"),
    ]
    for root in roots:
        if not root.exists():
            continue
        versions = sorted([entry for entry in root.iterdir() if entry.is_dir()], reverse=True)
        for version in versions:
            candidate = version / "lib" / "x64"
            if (candidate / "libcpmt.lib").exists():
                return candidate
    return None


def _find_msvc_include_dirs() -> list[Path]:
    roots = [
        Path(r"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC"),
        Path(r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC"),
    ]
    for root in roots:
        if not root.exists():
            continue
        versions = sorted([entry for entry in root.iterdir() if entry.is_dir()], reverse=True)
        for version in versions:
            include_dir = version / "include"
            if (include_dir / "vector").exists() and (include_dir / "cstdio").exists():
                return [include_dir]
    return []


def _find_windows_sdk_lib_dirs() -> list[Path]:
    sdk_root = Path(r"C:\Program Files (x86)\Windows Kits\10\Lib")
    if not sdk_root.exists():
        return []

    versions = sorted([entry for entry in sdk_root.iterdir() if entry.is_dir()], reverse=True)
    for version in versions:
        ucrt = version / "ucrt" / "x64"
        um = version / "um" / "x64"
        if (ucrt / "libucrt.lib").exists() and (um / "kernel32.lib").exists():
            return [ucrt, um]
    return []


def _find_windows_sdk_include_dirs() -> list[Path]:
    sdk_root = Path(r"C:\Program Files (x86)\Windows Kits\10\Include")
    if not sdk_root.exists():
        return []

    versions = sorted([entry for entry in sdk_root.iterdir() if entry.is_dir()], reverse=True)
    for version in versions:
        ucrt = version / "ucrt"
        um = version / "um"
        shared = version / "shared"
        if (ucrt / "stdio.h").exists() and (um / "windows.h").exists() and (shared / "guiddef.h").exists():
            return [ucrt, um, shared]
    return []


def _resolve_onetbb_include_dir(oneapi_root: Path | None) -> Path | None:
    root_candidates: list[Path] = []
    if oneapi_root is not None:
        root_candidates.extend(
            [
                oneapi_root / "compiler" / "latest" / "include",
                oneapi_root / "compiler" / "2025.3" / "include",
                oneapi_root / "tbb" / "latest" / "include",
                oneapi_root / "tbb" / "2022.3" / "include",
            ]
        )
    for candidate in root_candidates:
        if (candidate / "tbb" / "parallel_for.h").exists():
            return candidate
    return _find_onetbb_include_dir()


def _resolve_onetbb_lib_dir(oneapi_root: Path | None) -> Path | None:
    root_candidates: list[Path] = []
    if oneapi_root is not None:
        root_candidates.extend(
            [
                oneapi_root / "tbb" / "latest" / "lib",
                oneapi_root / "tbb" / "2022.3" / "lib",
                oneapi_root / "compiler" / "latest" / "lib",
                oneapi_root / "compiler" / "2025.3" / "lib",
            ]
        )
    for candidate in root_candidates:
        if (candidate / "tbb12.lib").exists():
            return candidate
    return _find_onetbb_lib_dir()


def _resolve_onetbb_bin_dir(oneapi_root: Path | None) -> Path | None:
    root_candidates: list[Path] = []
    if oneapi_root is not None:
        root_candidates.extend(
            [
                oneapi_root / "tbb" / "latest" / "bin",
                oneapi_root / "tbb" / "2022.3" / "bin",
                oneapi_root / "compiler" / "latest" / "bin",
                oneapi_root / "compiler" / "2025.3" / "bin",
            ]
        )
    for candidate in root_candidates:
        if (candidate / "tbb12.dll").exists():
            return candidate
    return _find_onetbb_bin_dir()


def get_dds_runtime_search_dirs() -> list[Path]:
    dirs: list[Path] = [BIN_DIR]
    icpx = _find_icpx_compiler()
    oneapi_root = _find_oneapi_root(icpx)
    tbb_bin = _resolve_onetbb_bin_dir(oneapi_root)
    if tbb_bin is not None:
        dirs.append(tbb_bin)
    dirs.append(icpx.parent)
    return dirs


def ensure_dds_dll() -> Path:
    with _build_lock:
        BIN_DIR.mkdir(parents=True, exist_ok=True)

        compiler = _find_icpx_compiler()
        compiler_kind = "icpx"
        oneapi_root = _find_oneapi_root(compiler)
        tbb_include = _resolve_onetbb_include_dir(oneapi_root)
        tbb_lib = _resolve_onetbb_lib_dir(oneapi_root)
        tbb_bin = _resolve_onetbb_bin_dir(oneapi_root)

        if tbb_include is None or tbb_lib is None or tbb_bin is None:
            raise RuntimeError("Could not locate oneTBB include/lib/bin directories for oneAPI performance build")

        _copy_runtime_dlls(ICPX_RUNTIME_DLLS, compiler.parent)
        _copy_runtime_dlls(TBB_RUNTIME_DLLS, tbb_bin)

        if not _needs_rebuild(DDS_DLL, DDS_ROOT / "library" / "src"):
            return DDS_DLL

        include_root = DDS_ROOT / "library" / "src"
        sources = sorted(str(path) for path in include_root.rglob("*.cpp"))
        command = [
            str(compiler),
            "-std=c++20",
            "-O3",
            "-xHost",
            "-ipo",
            "-ffast-math",
            "-DNDEBUG",
            "-shared",
            "-I",
            str(include_root),
            "-I",
            str(tbb_include),
            "-o",
            str(DDS_DLL),
            *sources,
            str(tbb_lib / "tbb12.lib"),
        ]

        env = os.environ.copy()
        compiler_bin = str(compiler.parent)
        env["PATH"] = compiler_bin + os.pathsep + env.get("PATH", "")
        extra_path_entries: list[str] = [str(tbb_bin)]
        env["PATH"] = os.pathsep.join(extra_path_entries + [env["PATH"]])

        lib_dir = _find_icpx_lib_dir(compiler)
        msvc_lib_dir = _find_msvc_x64_lib_dir()
        sdk_lib_dirs = _find_windows_sdk_lib_dirs()
        msvc_include_dirs = _find_msvc_include_dirs()
        sdk_include_dirs = _find_windows_sdk_include_dirs()

        lib_entries: list[str] = [str(tbb_lib)]
        if lib_dir is not None:
            lib_entries.append(str(lib_dir))
        if msvc_lib_dir is not None:
            lib_entries.append(str(msvc_lib_dir))
        lib_entries.extend(str(path) for path in sdk_lib_dirs)
        if lib_entries:
            env["LIB"] = os.pathsep.join(lib_entries + [env.get("LIB", "")])

        include_entries = [str(path) for path in msvc_include_dirs]
        include_entries.extend(str(path) for path in sdk_include_dirs)
        if include_entries:
            env["INCLUDE"] = os.pathsep.join(include_entries + [env.get("INCLUDE", "")])

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
        return DDS_DLL