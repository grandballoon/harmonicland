#!/bin/sh
# Rebuild every model, audit the axioms, and re-run every counterexample
# against the real TypeScript. Run from anywhere; needs elan and Node 22.
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.elan/bin:$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

echo "== Lean: build =="
lake build

echo "== Lean: no sorry, no added axioms =="
# (the audit below is the real check: a sorry or a native_decide is an axiom to it)
if grep -n "sorry\|^axiom \|^unsafe \|partial def" Harmonicland/*.lean; then
  echo "found one of: sorry, axiom, unsafe, partial def" >&2
  exit 1
fi
lake env lean Audit.lean

echo "== Lean: theorems written, per file =="
for f in Harmonicland/*.lean; do
  printf '%-34s %4s theorems, %2s FAILS_\n' "$f" "$(grep -c '^theorem ' "$f")" "$(grep -c '^theorem .*FAILS_' "$f")"
done

if [ "$1" = "--repro" ]; then
  echo "== TypeScript: every counterexample, on the real code =="
  cd ..
  for f in proofs/repro/*.ts; do
    case "$(basename "$f")" in _*|*_child.ts) continue ;; esac
    echo "--- $f"
    node node_modules/.bin/vite-node "$f"
  done
fi
