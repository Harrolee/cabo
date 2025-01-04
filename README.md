## Update Code

ci/cd will build a new container, push it to GAR, and then deploy it to Cloud Run.

## Update infra

`terraform apply` will redeploy the webapp and the Cloud Function. It will use the latest webapp image. Remember to push code changes.

