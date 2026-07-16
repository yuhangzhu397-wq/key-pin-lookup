#!/bin/sh

set -eu

: "${IMAGE:?Set IMAGE to the immutable image built by the pipeline}"
: "${KUBE_NAMESPACE:?Set KUBE_NAMESPACE to the target namespace}"

secret_name=${SECRET_NAME:-key-pin-lookup-secrets}
manifest=${MANIFEST:-deploy/kubernetes.yaml}

# The JoyBuilder Ops token must be provisioned out of band as a Kubernetes
# Secret. Do not pass it on this script's command line or write it to Git.
kubectl --namespace "$KUBE_NAMESPACE" get secret "$secret_name" >/dev/null

sed "s|REGISTRY/joymaas/key-pin-lookup:VERSION|${IMAGE}|g" "$manifest" \
  | kubectl --namespace "$KUBE_NAMESPACE" apply -f -

kubectl --namespace "$KUBE_NAMESPACE" rollout status \
  deployment/key-pin-lookup \
  --timeout "${ROLLOUT_TIMEOUT:-180s}"

kubectl --namespace "$KUBE_NAMESPACE" get \
  deployment/key-pin-lookup service/key-pin-lookup
