#!/usr/bin/env bash
# Guard the migration directory against the failures that only show up after
# two PRs land: golang-migrate refuses to build its source driver when two
# files share a version, and the backend then restart-loops at boot.
#
# Run by `make check-migrations` and by the Migrations job in CI.
set -euo pipefail

DIR="${1:-internal/infrastructure/db/migrations}"

if [ ! -d "$DIR" ]; then
	echo "check-migrations: no such directory: $DIR" >&2
	exit 1
fi

status=0
fail() {
	echo "check-migrations: $*" >&2
	status=1
}

shopt -s nullglob
files=("$DIR"/*)
if [ ${#files[@]} -eq 0 ]; then
	fail "no migrations found in $DIR"
	exit 1
fi

# 1. Naming. golang-migrate parses <version>_<name>.<direction>.sql; anything
#    else is either ignored silently or rejected at boot.
for path in "${files[@]}"; do
	name=$(basename "$path")
	if ! [[ $name =~ ^[0-9]{6}_[a-z0-9_]+\.(up|down)\.sql$ ]]; then
		fail "bad filename '$name' (expected 000123_snake_case_name.up.sql / .down.sql)"
	fi
done

ups=("$DIR"/*.up.sql)
if [ ${#ups[@]} -eq 0 ]; then
	fail "no .up.sql migrations found in $DIR"
	exit 1
fi

# 2. Duplicate versions. This is the one that breaks production: both PRs are
#    green on their own and the collision only exists once both are on main.
dupes=$(printf '%s\n' "${ups[@]}" | xargs -n1 basename | cut -d_ -f1 | sort | uniq -d)
if [ -n "$dupes" ]; then
	for version in $dupes; do
		fail "duplicate migration version $version:"
		for path in "$DIR/${version}_"*; do
			echo "    $path" >&2
		done
	done
	echo "check-migrations: renumber the migration that has NOT been released yet to the next free version; renumbering one that deployments already applied makes them re-run it." >&2
fi

# 3. Every up needs its down, so a rollback does not stop halfway.
for path in "${ups[@]}"; do
	down=${path%.up.sql}.down.sql
	[ -f "$down" ] || fail "missing $(basename "$down") for $(basename "$path")"
done
for path in "$DIR"/*.down.sql; do
	up=${path%.down.sql}.up.sql
	[ -f "$up" ] || fail "missing $(basename "$up") for $(basename "$path")"
done

# 4. No gaps. A hole means a version was renumbered or dropped without
#    reconciling the ones after it, which is how a duplicate gets introduced.
prev=0
while read -r version; do
	current=$((10#$version))
	if [ "$current" -ne $((prev + 1)) ]; then
		if [ "$prev" -eq 0 ]; then
			fail "migrations start at $version, expected 000001"
		elif [ "$current" -ne "$prev" ]; then
			fail "gap in migration versions: $(printf '%06d' "$prev") is followed by $version"
		fi
	fi
	prev=$current
done < <(printf '%s\n' "${ups[@]}" | xargs -n1 basename | cut -d_ -f1 | sort -n)

if [ "$status" -ne 0 ]; then
	exit 1
fi

echo "check-migrations: ${#ups[@]} migrations, versions 000001-$(printf '%06d' "$prev"), no duplicates."
