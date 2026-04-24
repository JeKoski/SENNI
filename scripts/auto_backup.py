"""
auto_backup.py — Called on server startup to snapshot user data.

Backs up config.json and the companions/ directory.
Keeps the 10 most recent backups and deletes older ones.
"""

import logging
import shutil
from datetime import datetime

from scripts.paths import BACKUPS_DIR, COMPANIONS_DIR, CONFIG_FILE

log = logging.getLogger(__name__)


def run_backup() -> None:
    BACKUPS_DIR.mkdir(exist_ok=True)

    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    dest  = BACKUPS_DIR / stamp
    dest.mkdir()

    copied = 0

    # config.json
    if CONFIG_FILE.exists():
        shutil.copy2(CONFIG_FILE, dest / CONFIG_FILE.name)
        copied += 1

    # companions/
    if COMPANIONS_DIR.exists():
        shutil.copytree(str(COMPANIONS_DIR), str(dest / "companions"))
        copied += sum(1 for _ in (dest / "companions").rglob("*") if _.is_file())

    # Prune — keep only the 10 most recent backups
    backups = sorted(b for b in BACKUPS_DIR.iterdir() if b.is_dir())
    for old in backups[:-10]:
        shutil.rmtree(old, ignore_errors=True)

    log.info("[backup] %d files → backups/%s/", copied, stamp)
