#!/bin/bash

# Read commit hashes from file (reverse order to apply oldest first)
COMMITS=$(tac my_commits.txt)

echo "Cherry-picking the following commits onto $(git branch --show-current):"
echo "$COMMITS"

for commit in $COMMITS; do
    echo "Cherry-picking $commit ..."
    git cherry-pick $commit
    if [ $? -ne 0 ]; then
        echo "Conflict detected while cherry-picking $commit."
        echo "Please resolve the conflict, then run:"
        echo "    git add <resolved-files>"
        echo "    git cherry-pick --continue"
        echo "Then re-run this script to continue."
        exit 1
    fi
done

echo "All commits cherry-picked successfully!"