#!/usr/bin/env python3

import pathlib
import sys
import zipfile


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: make-artifact.py OUTPUT_ZIP ZIP_ENTRY PAYLOAD_FILE", file=sys.stderr)
        return 2

    output_zip = pathlib.Path(sys.argv[1])
    zip_entry = sys.argv[2]
    payload_file = pathlib.Path(sys.argv[3])

    if zip_entry.startswith(("/", "\\")):
        print("ZIP_ENTRY must be relative", file=sys.stderr)
        return 2

    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(zip_entry, payload_file.read_bytes())

    print(f"created {output_zip} with entry {zip_entry}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
