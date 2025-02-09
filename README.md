## Update Code

ci/cd will build a new container, push it to GAR, and then deploy it to Cloud Run.

## Update infra

`terraform apply` will redeploy the webapp and the Cloud Function. It will use the latest webapp image. Remember to push code changes.

## Architecture

```mermaid
sequenceDiagram
    participant User
    participant Webapp
    participant create_subscription
    participant signup
    participant process_sms
    participant motivational_images
    participant Stripe
    participant Twilio

    User->>Webapp: Enters contact info
    Webapp->>create_subscription: POST /create-subscription
    create_subscription->>Stripe: Create subscription
    Stripe-->>create_subscription: Return clientSecret
    create_subscription-->>Webapp: Return clientSecret

    User->>Webapp: Completes payment
    Webapp->>signup: POST /handle-user-signup
    signup->>Twilio: Send welcome message
    signup-->>Webapp: Confirm signup

    Note over process_sms: Handles incoming SMS<br/>e.g. STOP, HELP, etc
    Twilio->>process_sms: Webhook for incoming SMS
    process_sms-->>Twilio: Response message

    Note over motivational_images: Scheduled daily job
    motivational_images->>Twilio: Send daily motivation<br/>and fitness images
```

## supabase sync

check bitwarden

## To Do

- Users can unsubscribe by texting one of the A2P opt-out keywords. We need to add a webhook and a cloud function to update supabase to handle this.