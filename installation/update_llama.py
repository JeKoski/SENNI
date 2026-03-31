#!/usr/bin/env python3
"""
SENNI — llama.cpp Installer & Updater
Supports Intel Arc / oneAPI (SYCL) builds on Linux.
"""

import os
import sys
import shutil
import subprocess
import platform
from datetime import datetime
from pathlib import Path

# ── Colour helpers ─────────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RED    = "\033[91m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
WHITE  = "\033[97m"

def c(text, *codes):
    return "".join(codes) + str(text) + RESET

def banner():
    print()
    print(c("╔══════════════════════════════════════════════════════╗", CYAN, BOLD))
    print(c("║        SENNI — llama.cpp Installer & Updater         ║", CYAN, BOLD))
    print(c("╚══════════════════════════════════════════════════════╝", CYAN, BOLD))
    print()

def section(title):
    print()
    print(c(f"  ── {title} ", CYAN, BOLD) + c("─" * max(0, 50 - len(title)), CYAN, DIM))
    print()

def info(label, value, status=None):
    """Print a labelled info row. status: 'ok', 'warn', 'missing', or None."""
    icons = {"ok": c("✔", GREEN, BOLD), "warn": c("!", YELLOW, BOLD), "missing": c("✘", RED, BOLD)}
    icon = icons.get(status, " ")
    label_fmt = c(f"{label:<28}", WHITE)
    value_fmt = c(value, YELLOW) if status == "warn" else (c(value, RED) if status == "missing" else c(value, WHITE))
    print(f"    {icon}  {label_fmt} {value_fmt}")

def step(msg):
    print(f"\n  {c('→', CYAN, BOLD)}  {c(msg, WHITE)}")

def success(msg):
    print(f"\n  {c('✔', GREEN, BOLD)}  {c(msg, GREEN)}")

def warn(msg):
    print(f"\n  {c('!', YELLOW, BOLD)}  {c(msg, YELLOW)}")

def error(msg):
    print(f"\n  {c('✘', RED, BOLD)}  {c(msg, RED, BOLD)}")

def ask(prompt, default=None):
    hint = f" [{c(default, CYAN)}]" if default else ""
    try:
        val = input(f"\n    {c('?', CYAN, BOLD)}  {prompt}{hint}: ").strip()
    except (KeyboardInterrupt, EOFError):
        print()
        abort()
    return val or default or ""

def ask_yn(prompt, default="y"):
    hint = c("Y/n", CYAN) if default == "y" else c("y/N", CYAN)
    try:
        val = input(f"\n    {c('?', CYAN, BOLD)}  {prompt} [{hint}]: ").strip().lower()
    except (KeyboardInterrupt, EOFError):
        print()
        abort()
    if val == "":
        return default == "y"
    return val.startswith("y")

def abort(msg="Cancelled."):
    print()
    warn(msg)
    print()
    sys.exit(0)

def fatal(msg):
    error(msg)
    print()
    sys.exit(1)

# ── System checks ──────────────────────────────────────────────────────────────

ONEAPI_SETVARS = Path("/opt/intel/oneapi/setvars.sh")
LLAMA_CPP_REPO = "https://github.com/ggerganov/llama.cpp.git"

CMAKE_FLAGS_BASE = [
    "-DGGML_SYCL=ON",
    "-DGGML_SYCL_TARGET=INTEL",
    "-DGGML_SYCL_DNN=ON",
    "-DGGML_SYCL_GRAPH=ON",
    "-DGGML_SYCL_F16=ON",
    "-DCMAKE_BUILD_TYPE=Release",
    # Explicit compiler flags as required by the official SYCL build guide
    "-DCMAKE_C_COMPILER=icx",
    "-DCMAKE_CXX_COMPILER=icpx",
]

def detect_cpu_cores():
    try:
        count = os.cpu_count() or 4
        return max(1, count // 2)
    except Exception:
        return 4

def check_oneapi():
    return ONEAPI_SETVARS.exists()

def check_git():
    return shutil.which("git") is not None

def check_cmake():
    return shutil.which("cmake") is not None

def check_render_group():
    """Check if current user is in the 'render' and 'video' groups."""
    try:
        import grp
        username = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
        user_groups = [g.gr_name for g in grp.getgrall() if username in g.gr_mem]
        in_render = "render" in user_groups
        in_video  = "video"  in user_groups
        return in_render, in_video
    except Exception:
        return True, True  # Don't block if we can't check

def verify_sycl_gpu(oneapi_sh: Path):
    """
    Source oneAPI and run sycl-ls to confirm a level_zero GPU is visible.
    Returns (found: bool, output: str).
    """
    try:
        script = f"source {oneapi_sh} --force intel64 2>/dev/null && sycl-ls"
        result = subprocess.run(
            ["bash", "-c", script],
            capture_output=True, text=True, timeout=30
        )
        output = result.stdout + result.stderr
        found  = "level_zero:gpu" in output.lower()
        return found, output.strip()
    except Exception as e:
        return False, str(e)

def is_llama_repo(path: Path):
    return (path / ".git").exists() and (path / "CMakeLists.txt").exists()

def get_modified_files(repo: Path):
    """
    Return two lists of files that need attention before git pull:
    - untracked: new files git doesn't know about at all
    - modified:  tracked files with local changes that would block git pull
    """
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(repo), capture_output=True, text=True
        )
        untracked = []
        modified  = []
        for line in result.stdout.splitlines():
            xy    = line[:2]
            fpath = line[3:].strip().strip('"')
            if xy == "??":
                untracked.append(fpath)
            elif xy.strip() in ("M", "A", "AM", "MM"):
                modified.append(fpath)
        return untracked, modified
    except Exception:
        return [], []

def backup_files(repo: Path, backup_dir: Path, untracked: list, modified: list):
    all_files = untracked + modified
    if not all_files:
        return 0
    backup_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for rel in all_files:
        src = repo / rel
        dst = backup_dir / rel
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(src), str(dst))
            count += 1
    return count

def reset_modified_files(repo: Path):
    """
    Discard all local modifications to tracked files so git pull can proceed.
    Only called after backup_files has confirmed files are safely copied.
    """
    try:
        subprocess.run(["git", "checkout", "."], cwd=str(repo), capture_output=True)
        subprocess.run(["git", "clean", "-fd"],  cwd=str(repo), capture_output=True)
    except Exception:
        pass

# ── oneAPI install guidance ────────────────────────────────────────────────────

def print_oneapi_guide():
    print()
    print(c("  Intel oneAPI was not found on this system.", RED, BOLD))
    print(c("  This is required to build llama.cpp with Intel Arc GPU support.", WHITE))
    print()
    print(c("  ── What to install ───────────────────────────────────────", CYAN))
    print()
    print(c("  You have two options:", WHITE))
    print()
    print(c("  Option A — Intel® Deep Learning Essentials  (recommended)", GREEN, BOLD))
    print(c("  A smaller, focused package with just the libraries llama.cpp needs.", WHITE))
    print(c("  Great choice if you want a leaner install and don't need the full toolkit.", DIM))
    print()
    print(c("    sudo apt install intel-deep-learning-essentials", DIM))
    print()
    print(c("  Option B — Intel® oneAPI Base Toolkit  (full install)", WHITE, BOLD))
    print(c("  The complete toolkit. Larger download but includes everything.", DIM))
    print()
    print(c("    sudo apt install intel-basekit", DIM))
    print()
    print(c("  ── Setting up Intel's package repository ─────────────────", CYAN))
    print()
    print(c("  Both options require Intel's apt repo. Run these first:", WHITE))
    print()
    print(c("     wget -O- https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB \\", DIM))
    print(c("       | gpg --dearmor | sudo tee /usr/share/keyrings/oneapi-archive-keyring.gpg > /dev/null", DIM))
    print()
    print(c("     echo 'deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] \\", DIM))
    print(c("       https://apt.repos.intel.com/oneapi all main' \\", DIM))
    print(c("       | sudo tee /etc/apt/sources.list.d/oneAPI.list", DIM))
    print()
    print(c("     sudo apt update", DIM))
    print()
    print(c("  Then install whichever option you chose above, and run this script again.", WHITE))
    print()
    print(c("  Intel's download page:", DIM))
    print(c("    https://www.intel.com/content/www/us/en/developer/tools/oneapi/base-toolkit.html", DIM))
    print()

# ── Confirmation summary ───────────────────────────────────────────────────────

def print_summary(mode, llama_path, backup_dir, total_backup_count,
                  modified_count, cores, is_fresh_clone,
                  flash_attn, sycl_f16, in_render, in_video):
    print()
    print(c("╔══════════════════════════════════════════════════════╗", CYAN, BOLD))
    print(c("║                  Ready to proceed                   ║", CYAN, BOLD))
    print(c("╚══════════════════════════════════════════════════════╝", CYAN, BOLD))
    print()
    print(c("  Here's a summary of everything that was found and", WHITE))
    print(c("  what is about to happen. Nothing has changed yet.", WHITE, BOLD))
    print()

    section("What we found")
    info("Mode",           "Fresh install" if mode == "install" else "Update existing install")
    info("llama.cpp path", str(llama_path), status="ok" if not is_fresh_clone else "warn")
    info("Intel oneAPI",   str(ONEAPI_SETVARS), status="ok")
    info("git",            shutil.which("git"),   status="ok")
    info("cmake",          shutil.which("cmake"), status="ok")

    if not in_render or not in_video:
        missing_groups = []
        if not in_render: missing_groups.append("render")
        if not in_video:  missing_groups.append("video")
        info("GPU user groups",
             f"Missing: {', '.join(missing_groups)} — GPU may not be accessible",
             status="warn")
    else:
        info("GPU user groups", "render, video  ✔", status="ok")

    section("Build options")
    info("Parallel build jobs",  str(cores))
    info("FP16 compute",         "Enabled (recommended — saves VRAM)" if sycl_f16 else "Disabled")
    info("Flash Attention",      "Enabled (saves GPU memory)" if flash_attn else "Disabled")
    info("Compiler",             "icx / icpx  (Intel oneAPI)")
    info("Build type",           "Release")

    section("What will happen")

    step_num = 1
    steps = []

    if is_fresh_clone:
        steps.append(f"{step_num}. Clone llama.cpp from GitHub into:  {llama_path}")
        step_num += 1
    else:
        steps.append(f"{step_num}. Run 'git pull' to fetch the latest changes")
        step_num += 1

    if total_backup_count > 0:
        backup_detail = f"{total_backup_count} file(s)"
        if modified_count > 0:
            backup_detail += f"  ({modified_count} modified repo file(s) will also be reset after backup)"
        steps.append(
            f"{step_num}. Back up {backup_detail} to:\n"
            f"              {backup_dir}"
        )
    else:
        steps.append(f"{step_num}. No files to back up — repo is clean")
    step_num += 1

    if modified_count > 0:
        steps.append(f"{step_num}. Reset modified repo files so the update can proceed cleanly")
        step_num += 1

    steps.append(f"{step_num}. Source Intel oneAPI environment")
    step_num += 1
    steps.append(f"{step_num}. Verify your Intel Arc GPU is visible to the system (sycl-ls)")
    step_num += 1
    steps.append(f"{step_num}. Run cmake with Intel SYCL flags")
    step_num += 1
    steps.append(f"{step_num}. Build llama.cpp using {cores} CPU thread(s)")
    step_num += 1
    steps.append(f"{step_num}. Confirm the build succeeded")

    for s in steps:
        lines = s.split("\n")
        print(f"    {c('·', CYAN)}  {c(lines[0], WHITE)}")
        for extra in lines[1:]:
            print(f"       {c(extra, DIM)}")

    section("Your files are safe")
    if total_backup_count > 0:
        print(c(f"  All modified and custom files will be copied to:", WHITE))
        print()
        print(c(f"    {backup_dir}", YELLOW))
        print()
        print(c("  Nothing is permanently deleted.", WHITE))
        print(c("  Check the backup folder after the update and delete it", DIM))
        print(c("  once you're happy everything is working fine.", DIM))
    else:
        print(c("  Repo is clean — nothing to back up.", DIM))

    print()

# ── Build ──────────────────────────────────────────────────────────────────────

def run_build(llama_path: Path, cores: int, flash_attn: bool, sycl_f16: bool):
    """Source oneAPI and run cmake + make inside the llama.cpp folder."""
    build_dir = llama_path / "build"
    build_dir.mkdir(exist_ok=True)

    flags = CMAKE_FLAGS_BASE.copy()
    # Override the F16 default based on user's choice
    flags = [f for f in flags if "GGML_SYCL_F16" not in f]
    flags.append(f"-DGGML_SYCL_F16={'ON' if sycl_f16 else 'OFF'}")
    if flash_attn:
        flags.append("-DGGML_SYCL_FLASH_ATTN=ON")

    flags_str = " ".join(flags)

    script = f"""
set -e
source {ONEAPI_SETVARS} --force intel64
cd {llama_path}
cmake -B build {flags_str}
cmake --build build --config Release -j{cores}
"""

    step("Sourcing Intel oneAPI environment and starting build…")
    step(f"Using {cores} parallel job(s). This may take 10–30 minutes.")
    print(c("\n  Build output:\n", DIM))

    result = subprocess.run(
        ["bash", "-c", script],
        cwd=str(llama_path),
    )
    return result.returncode == 0

# ── Main flow ──────────────────────────────────────────────────────────────────

def main():
    if platform.system() != "Linux":
        fatal("This script is for Linux only. Windows/macOS are not supported here.")

    banner()
    print(c("  Welcome! This script will install or update llama.cpp", WHITE))
    print(c("  on your system with Intel Arc GPU support.", WHITE))
    print(c("  You'll be asked a few questions before anything happens.", DIM))

    # ── Step 1: Install or update? ─────────────────────────────────────────────
    section("First things first")
    print(c("  Do you already have llama.cpp installed on this computer?", WHITE))
    print()
    print(c("    1 — Yes, I already have it and want to update it", WHITE))
    print(c("    2 — No, I need to install it from scratch", WHITE))
    print()

    while True:
        choice = ask("Enter 1 or 2")
        if choice in ("1", "2"):
            break
        print(c("    Please enter 1 or 2.", YELLOW))

    mode = "update" if choice == "1" else "install"

    # ── Step 2: Determine path ─────────────────────────────────────────────────
    default_path = Path.home() / "llama.cpp"

    if mode == "update":
        section("Finding your llama.cpp folder")
        print(c("  Where is your llama.cpp folder?", WHITE))
        raw = ask("Path to llama.cpp", str(default_path))
        llama_path = Path(raw).expanduser().resolve()

        if not llama_path.exists():
            fatal(f"Folder not found: {llama_path}\nPlease check the path and try again.")

        if not is_llama_repo(llama_path):
            fatal(
                f"This doesn't look like a llama.cpp repository: {llama_path}\n"
                "Expected a .git folder and CMakeLists.txt inside it.\n"
                "Please double-check the path."
            )

        success(f"Found a valid llama.cpp repository at: {llama_path}")
        is_fresh_clone = False

    else:
        section("Where to install llama.cpp")
        print(c("  llama.cpp will be cloned (downloaded) from GitHub.", WHITE))
        print(c(f"  Default location: {default_path}", DIM))
        print()
        use_default = ask_yn("Use the default location?")
        if use_default:
            llama_path = default_path
        else:
            raw = ask("Enter your preferred path")
            llama_path = Path(raw).expanduser().resolve()

        if llama_path.exists() and any(llama_path.iterdir()):
            warn(f"The folder {llama_path} already exists and is not empty.")
            if not ask_yn("Continue anyway? (existing contents may conflict)", default="n"):
                abort()

        is_fresh_clone = True

    # ── Step 3: Check oneAPI ───────────────────────────────────────────────────
    section("Checking Intel oneAPI")
    if not check_oneapi():
        print_oneapi_guide()
        fatal("Intel oneAPI is required but was not found. Please install it and run this script again.")

    success(f"Intel oneAPI found at: {ONEAPI_SETVARS}")

    # ── Step 4: Check git / cmake ──────────────────────────────────────────────
    section("Checking build tools")
    missing = []
    if not check_git():
        missing.append("git")
    if not check_cmake():
        missing.append("cmake")

    if missing:
        print()
        for tool in missing:
            info(tool, "NOT FOUND", status="missing")
        print()
        print(c("  Install missing tools with:", WHITE))
        print(c(f"    sudo apt install {' '.join(missing)}", DIM))
        fatal("Required tools are missing. Please install them and try again.")

    info("git",   shutil.which("git"),   status="ok")
    info("cmake", shutil.which("cmake"), status="ok")

    # ── Step 4b: Check render/video group membership ───────────────────────────
    in_render, in_video = check_render_group()
    if not in_render or not in_video:
        missing_groups = []
        if not in_render: missing_groups.append("render")
        if not in_video:  missing_groups.append("video")
        groups_str = " ".join(missing_groups)
        print()
        warn(
            f"Your user is not in the '{groups_str}' group(s).\n\n"
            f"  This can prevent llama.cpp from accessing your GPU after building.\n"
            f"  It won't stop the build, but you may hit permission errors at runtime.\n\n"
            f"  To fix it, run:\n"
            f"    sudo usermod -aG {groups_str} $USER\n\n"
            f"  Then log out and back in for the change to take effect."
        )
        print()
        if not ask_yn("Continue anyway?", default="y"):
            abort("Come back after fixing the group membership!")
    else:
        info("GPU user groups", "render, video  ✔", status="ok")

    # ── Step 5: Parallel jobs ──────────────────────────────────────────────────
    default_cores = detect_cpu_cores()
    section("Build settings")
    print(c(f"  Detected {os.cpu_count() or '?'} CPU threads. Recommended parallel jobs: {default_cores}", WHITE))
    print(c("  Fewer jobs = slower build but uses less memory.", DIM))
    print(c("  More jobs = faster build but needs more RAM.", DIM))
    print()
    override = ask_yn(f"Use {default_cores} parallel job(s)? (choose No to set a different number)")
    if override:
        cores = default_cores
    else:
        while True:
            raw = ask("How many parallel jobs?", str(default_cores))
            try:
                cores = int(raw)
                if cores >= 1:
                    break
            except ValueError:
                pass
            print(c("    Please enter a whole number (e.g. 4).", YELLOW))

    # ── Step 5b: Flash Attention ───────────────────────────────────────────────
    section("Flash Attention (optional)")
    print(c("  Flash Attention is a newer feature that can reduce how much GPU memory", WHITE))
    print(c("  llama.cpp uses while running. This can help with larger models.", WHITE))
    print()
    print(c("  It was added recently and its performance impact varies by model —", DIM))
    print(c("  it may be faster, similar, or occasionally slightly slower.", DIM))
    print()
    flash_attn = ask_yn("Enable Flash Attention?", default="n")

    # ── Step 5c: FP16 ─────────────────────────────────────────────────────────
    section("FP16 (half-precision) compute")
    print(c("  FP16 reduces how much VRAM llama.cpp uses during computation.", WHITE))
    print(c("  It does not affect your model's weights or quality — only the", WHITE))
    print(c("  intermediate calculations the GPU performs.", WHITE))
    print()
    print(c("  Recommended ON  for 8GB VRAM cards (Arc A750, A770, etc.)", GREEN))
    print(c("  Optional  OFF  if you have 16GB+ VRAM and want maximum precision", DIM))
    print()
    sycl_f16 = ask_yn("Enable FP16? (recommended for most users)", default="y")

    # ── Step 6: Backup plan ────────────────────────────────────────────────────
    today = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_dir    = Path.home() / f"llama.cpp_backup_{today}"
    untracked_files = []
    modified_files  = []

    if not is_fresh_clone:
        untracked_files, modified_files = get_modified_files(llama_path)

    total_backup_count = len(untracked_files) + len(modified_files)

    # ── Step 7: Summary + confirmation ────────────────────────────────────────
    print_summary(mode, llama_path, backup_dir, total_backup_count,
                  len(modified_files), cores, is_fresh_clone,
                  flash_attn, sycl_f16, in_render, in_video)

    if not ask_yn(c("Everything look good? Shall we begin?", WHITE, BOLD)):
        abort("No changes were made. Come back whenever you're ready!")

    # ══════════════════════════════════════════════════════════════════════════
    # FROM HERE ON: actual changes to the system
    # ══════════════════════════════════════════════════════════════════════════

    # ── Clone or pull ──────────────────────────────────────────────────────────
    section("Getting the latest llama.cpp")

    if is_fresh_clone:
        step(f"Cloning llama.cpp into {llama_path}…")
        result = subprocess.run(["git", "clone", LLAMA_CPP_REPO, str(llama_path)])
        if result.returncode != 0:
            fatal("Git clone failed. Check your internet connection and try again.")
        success("Repository cloned successfully.")
    else:
        # Backup all modified and untracked files first
        if total_backup_count > 0:
            step(
                f"Backing up {total_backup_count} file(s) to {backup_dir}…\n"
                + (f"       ({len(modified_files)} modified repo file(s), "
                   f"{len(untracked_files)} custom file(s))"
                   if modified_files else "")
            )
            backed = backup_files(llama_path, backup_dir, untracked_files, modified_files)
            success(f"Backed up {backed} file(s). They are safe in: {backup_dir}")

            # Reset modified tracked files so git pull can proceed cleanly
            if modified_files:
                step("Resetting modified repo files so the update can proceed…")
                reset_modified_files(llama_path)
                success("Repo files reset. Your copies are safe in the backup folder.")
        else:
            step("No files to back up — repo is clean.")

        step("Pulling latest changes from GitHub…")
        result = subprocess.run(["git", "pull"], cwd=str(llama_path))
        if result.returncode != 0:
            fatal(
                "Git pull failed. This could be due to:\n"
                "  · No internet connection\n"
                "  · Local changes that conflict with the update\n\n"
                "  Your custom files are safe in: " + str(backup_dir) + "\n"
                "  No build changes were made."
            )
        success("Repository updated successfully.")

    # ── Verify GPU is visible ──────────────────────────────────────────────────
    section("Checking your GPU")
    step("Sourcing oneAPI and scanning for your Intel Arc GPU (sycl-ls)…")
    gpu_found, sycl_output = verify_sycl_gpu(ONEAPI_SETVARS)

    if gpu_found:
        success("Intel Arc GPU detected via level_zero — ready to build!")
    else:
        print()
        warn(
            "Could not confirm your GPU is visible to the oneAPI stack.\n\n"
            "  This doesn't necessarily mean something is broken, but it's worth\n"
            "  checking before a long build. The sycl-ls output was:\n\n"
            + "\n".join(f"    {line}" for line in sycl_output.splitlines()[:10])
        )
        print()
        print(c("  Common causes:", WHITE))
        print(c("    · Intel GPU drivers not installed (intel-gpu-tools / level-zero)", DIM))
        print(c("    · User not in 'render' or 'video' groups (see earlier warning)", DIM))
        print(c("    · oneAPI install incomplete", DIM))
        print()
        if not ask_yn("Continue with the build anyway?", default="n"):
            abort(
                "Build cancelled. Fix the GPU visibility issue and try again.\n"
                "  Your repo and files have not been changed."
            )

    # ── Build ──────────────────────────────────────────────────────────────────
    section("Building llama.cpp")
    build_ok = run_build(llama_path, cores, flash_attn, sycl_f16)

    if not build_ok:
        print()
        error("The build failed.")
        print()
        print(c("  Don't worry — your system has not been broken.", WHITE))
        print()
        if total_backup_count > 0:
            print(c(f"  Your custom files are safe in: {backup_dir}", YELLOW))
        print()
        print(c("  Things to try:", WHITE))
        print(c("    · Check the error messages above for clues", DIM))
        print(c("    · Make sure Intel oneAPI is fully installed", DIM))
        print(c("    · Try running with fewer parallel jobs (-j1 or -j2)", DIM))
        print(c("    · Check https://github.com/ggerganov/llama.cpp for known issues", DIM))
        print()
        sys.exit(1)

    # ── Done ───────────────────────────────────────────────────────────────────
    print()
    print(c("╔══════════════════════════════════════════════════════╗", GREEN, BOLD))
    print(c("║                 All done!  ✔                         ║", GREEN, BOLD))
    print(c("╚══════════════════════════════════════════════════════╝", GREEN, BOLD))
    print()
    print(c("  llama.cpp has been built successfully.", WHITE))
    print()
    print(c("  Built binary location:", WHITE))
    print(c(f"    {llama_path}/build/bin/llama-server", YELLOW))
    print()

    if total_backup_count > 0:
        print(c("  Your original custom files are in:", WHITE))
        print(c(f"    {backup_dir}", YELLOW))
        print(c("  Once you've confirmed everything is working, you can", DIM))
        print(c("  delete that folder — it's just a safety copy.", DIM))
        print()

    print(c("  You can now start SENNI as normal.", WHITE))
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        warn("Interrupted. No changes were made (or the build was stopped).")
        print()
        sys.exit(0)
