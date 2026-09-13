# Issue tracker: GitHub

Issues and specs live in GitHub Issues. Use the gh CLI.
Resolve the repository from git remote; currently Scrawach/nodic.

- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --comments
- List: gh issue list --state open
- Comment: gh issue comment <number> --body-file <file>
- Labels: gh issue edit <number> --add-label / --remove-label
- Close: gh issue close <number>

PRs as a request surface: no.

For wayfinder, use a map issue labelled wayfinder:map and linked
child issues labelled wayfinder:<type>. Use native issue dependencies;
fall back to explicit Blocked by references when unavailable.
Claim an unblocked child by assigning it to the driving developer.
Resolve it by recording the answer, closing it, and updating the map.
