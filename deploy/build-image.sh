#!/bin/sh

set -eu

: "${IMAGE_REPOSITORY:?Set IMAGE_REPOSITORY to the internal registry repository}"

if [ -n "${IMAGE_TAG:-}" ]; then
  image_tag=$IMAGE_TAG
elif [ -n "${GIT_COMMIT:-}" ]; then
  image_tag=$(printf '%s' "$GIT_COMMIT" | cut -c1-12)
else
  image_tag=$(git rev-parse --short=12 HEAD)
fi

image="${IMAGE_REPOSITORY}:${image_tag}"

DOCKER_BUILDKIT=1 docker build --pull --tag "$image" . >&2
docker push "$image" >&2

# Keep stdout machine-readable so a pipeline can capture it with:
# IMAGE=$(./deploy/build-image.sh)
printf '%s\n' "$image"
