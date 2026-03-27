#!/usr/bin/env python3
import os
from pathlib import Path

import pg8000


ROOT = Path(__file__).resolve().parent.parent
MIGRATION_PATH = ROOT / "supabase" / "migrations" / "20260327113000_add_owner_test_mode_to_agent_settings.sql"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def first_present(*values: str) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def build_connection() -> dict:
    host = first_present(os.environ.get("SUPABASE_DB_HOST"))
    database = first_present(os.environ.get("SUPABASE_DB_NAME"))
    user = first_present(os.environ.get("SUPABASE_DB_USER"))
    password = first_present(os.environ.get("SUPABASE_DB_PASSWORD"))
    port = int(os.environ.get("SUPABASE_DB_PORT") or "5432")

    if not host or not database or not user or not password:
        raise SystemExit(
            "Missing SUPABASE_DB_* settings in .env. This Python migrator expects host/port/db/user/password."
        )

    return {
        "host": host,
        "port": port,
        "database": database,
        "user": user,
        "password": password,
        "ssl_context": True,
    }


def main() -> None:
    load_env(ROOT / ".env")
    sql = MIGRATION_PATH.read_text()
    connection = pg8000.connect(**build_connection())
    try:
        cursor = connection.cursor()
        cursor.execute(sql)
        connection.commit()
        print('{"ok": true, "migration": "20260327113000_add_owner_test_mode_to_agent_settings.sql"}')
    finally:
        connection.close()


if __name__ == "__main__":
    main()
