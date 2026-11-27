#!/usr/bin/env python3
# Rewrite the esbuild Edge bundle so node:crypto is a static ESM import.
# esbuild leaves require("node:crypto") as runtime __require inside CJS
# wrappers, which throws in the Deno Edge runtime.
from pathlib import Path
import sys

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: rewrite-function-bundle.py <bundle.js>")
    path = Path(sys.argv[1])
    text = path.read_text()
    if '__require("node:crypto")' not in text and 'from "node:crypto"' in text:
        pass
    elif '__require("node:crypto")' not in text:
        raise SystemExit("bundle.js has no __require(\"node:crypto\") to rewrite")
    else:
        preamble = (
            'import * as __dogverbCryptoNS from "node:crypto";\n'
            "const __dogverbCrypto = new Proxy(__dogverbCryptoNS, {\n"
            "  get(target, prop) {\n"
            '    if (prop === "subtle" && target.subtle == null) {\n'
            "      return (target.webcrypto && target.webcrypto.subtle) || globalThis.crypto.subtle;\n"
            "    }\n"
            "    const value = target[prop];\n"
            '    return typeof value === "function" ? value.bind(target) : value;\n'
            "  }\n"
            "});\n"
        )
        text = preamble + text.replace('__require("node:crypto")', "__dogverbCrypto")
        path.write_text(text)
    if "handleRequest" not in text or "fsrs" not in text.lower():
        raise SystemExit("bundle.js is missing handleRequest or FSRS")
    if '__require("node:crypto")' in text:
        raise SystemExit("bundle.js still dynamically requires node:crypto")
    if 'from "node:crypto"' not in text:
        raise SystemExit("bundle.js is missing the static node:crypto import")

if __name__ == "__main__":
    main()
