#!/bin/sh
# Builds a fake beads project for this repository, for screenshots and trying the panel.
# It wipes this repository's beads database (bd keeps one per repository, shared by its worktrees),
# and refuses when that database is not a demo one.
set -eu
cd "$(dirname "$0")/.."
if dir=$(bd where 2>/dev/null | head -n 1) && [ -n "$dir" ]; then
  bd where | grep -q '^ *prefix: demo$' || { echo "Refusing: $dir is not a demo database." >&2; exit 1; }
  rm -rf "$dir"
fi
bd init --quiet --non-interactive --skip-agents --skip-hooks --prefix demo

# new <var> <bd create args...>: creates a bead and stores its id in <var>.
# Fixed ids on epics and loose beads, and children numbered in order, keep ids stable for scenarios.
new() {
  var=$1
  shift
  id=$(bd create "$@" --json | sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' | head -n 1)
  eval "$var=\$id"
}

new checkout --id demo-ck --title "Checkout redesign" --type epic --priority 1 \
  --description "Rebuild checkout as one page: shipping, payment and review, with fewer steps and clearer errors."
new search --id demo-sr --title "Product search" --type epic --priority 2 \
  --description "Let shoppers find products by name, category and typo-tolerant text."

new mockups --title "Design the one-page checkout" --parent "$checkout" --type task --priority 1
new form --title "Build the payment form" --parent "$checkout" --type feature --priority 1 \
  --description "## Goal
Collect card details on the checkout page with the provider's hosted fields.

## Notes
- Keep the **Pay** button disabled until the form is valid
- Show provider errors next to the field they concern" \
  --acceptance "- A valid card completes the order
- A declined card shows the reason inline
- Works with Apple Pay and Google Pay"
new inline --title "Validate card details inline" --parent "$checkout" --type task --priority 2
new summary --title "Show the order summary before paying" --parent "$checkout" --type task --priority 2
new receipt --title "Email the receipt after payment" --parent "$checkout" --type task --priority 3

new index --title "Index products by category" --parent "$search" --type task --priority 1
new typos --title "Typo-tolerant search" --parent "$search" --type feature --priority 2

new footer --id demo-ft --title "Fix the footer on small screens" --type bug --priority 1
new sdk --id demo-sdk --title "Upgrade the payment SDK" --type chore --priority 3
new guide --id demo-doc --title "Write the onboarding guide" --type task --priority 2

bd dep add "$inline" "$form" >/dev/null
bd dep add "$receipt" "$form" >/dev/null
bd dep add "$typos" "$index" >/dev/null

bd label add "$form" payments >/dev/null
bd label add "$form" frontend >/dev/null
bd label add "$footer" frontend >/dev/null

bd close "$mockups" --reason "Approved by design" >/dev/null
bd close "$guide" --reason "Published" >/dev/null
bd update "$checkout" --status in_progress --assignee "Ada Lovelace" >/dev/null
bd update "$form" --status in_progress --assignee "Ada Lovelace" >/dev/null
# An agent on a second task, so the panel shows more than one task in progress.
bd update "$footer" --status in_progress --assignee "Claude" >/dev/null

bd comments add "$form" "Hosted fields keep us out of PCI scope, so no card data touches our servers." --actor "Ada Lovelace" >/dev/null
bd comments add "$form" "Make sure **Apple Pay** still shows on Safari." --actor "Grace Hopper" >/dev/null

echo "Demo project ready: $(bd list --all --json -n 0 | grep -c '"id"') beads."
