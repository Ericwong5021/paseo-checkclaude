#!/bin/bash
# Rebuilds bin/ccprobe as a universal macOS binary from main.swift and the
# BrowserProbe/BrowserBridge classes copied from the CheckClaude menu bar app.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p bin
FRAMEWORKS=(-framework Cocoa -framework WebKit -framework Network)
swiftc -O -target arm64-apple-macosx12.0 main.swift CheckClaudeProbe.swift -o bin/ccprobe-arm64 "${FRAMEWORKS[@]}"
swiftc -O -target x86_64-apple-macosx12.0 main.swift CheckClaudeProbe.swift -o bin/ccprobe-x86_64 "${FRAMEWORKS[@]}"
lipo -create -output bin/ccprobe bin/ccprobe-arm64 bin/ccprobe-x86_64
rm -f bin/ccprobe-arm64 bin/ccprobe-x86_64
echo "built $(lipo -archs bin/ccprobe)"
