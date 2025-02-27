# AI-Powered Development and Deployment: How Terraform and Test Scripts Enable Autonomous Code Assistants

In the rapidly evolving landscape of software development, we're witnessing a paradigm shift in how applications are built and deployed. Don't believe me? Check out this short [video](https://youtu.be/eWrSOGOQKog?t=720) of Cline one-shotting a modern web application for a services company with Claude Sonnet 3.7. I think that's neat and all, but as an infrastructure junkie, I'm especially stoked for the potential of AI-powered deployment.

Today, I want to explore how infrastructure-as-code tools like Terraform can enable AI assistants to not just write code, but also deploy it autonomously. I'll use my goofy toy project, CaboFit, as a case study to demonstrate these principles in action.

## CaboFit: Reducing your braincells, one workout at a time

CaboFit is a thin wrapper around Twilio and a text-to-image model hosted on Replicate. Every morning, CaboFit sends a motivational text to the user, along with a before-after picture pair to inspire them.

If you really trust me, you can send a selfie to CaboFit.
![screenshot of an iphone Message app conversation where Lee sends a selfie to CaboFit](/images/cabo-fit.png)

CaboFit will send you an image pair with a motivational quote to inspire you.
![screenshot of an iphone Message app conversation where CaboFit sends an image pair to Lee](/images/cabo-fit.png)

If you don't trust me, you can describe yourself and CaboFit will generate an image pair for that description. And if you don't send anything, CaboFit will send you anthropomorphic mushrooms, or ogres.

![screenshot of an iphone Message app conversation where CaboFit sends an image of an anthropomorphic mushroom to Lee](/images/anthroShroom.PNG)

I made this app because a buddy I work out with asked another friend to send him two beach bod pictures every morning with a motivational quote attached. Someone else in the group said "that should be an app". Someone else said "Yeah, use AI to make pictures that look like you". I though that was pretty funny, and it seemed like a good excuse to play with this Cursor thing everybody was talking about.

## The Current State of AI-Assisted Development

Most developers are now familiar with AI coding assistants. Tools like Cursor, Cline, and Windsurf have made "rapid development" commonplace. These tools excel at:

- Generating boilerplate code
- Suggesting code completions
- Exchanging human interactions with all-night coding sessions
- Refactoring existing code
- Explaining complex code segments

But where this tool really shines is in the deployment phase.

## The Missing Piece: Rapid Deployment

Deployment involves numerous complex tasks:
- Setting up cloud infrastructure
- Configuring security policies
- Managing environment variables
- Orchestrating services
- Monitoring deployments

These tasks are often more error-prone and time-consuming than writing the application code itself. This is where infrastructure-as-code (IaC) tools like Terraform come in.

## Terraform: The Foundation for AI-Powered Deployment

Terraform allows us to define infrastructure using declarative configuration files. The first time I wrote Terraform, I was a wee SE1, pair-programming with Steven Kneisler. At the time, I barely even lifted, bro. Steven explained gingerly that I need not click endlessly through a labrynth of public cloud service UIs to enact my dreams. Instead, I could just write some code and watch it do the thing. I felt a burgeoning sense of power coarse through my veins, and grew two inches taller that day.

(Alternatively, add a picture of Steven Kneisler here)
![picture of He-Man](/images/he-man.png)

Terraform has key advantages that make it perfect for AI assistants:

1. **Declarative syntax**: Terraform configurations describe the desired end state rather than the steps to get there, making it easier for AI to reason about.

2. **Version control**: Infrastructure changes can be tracked in git alongside application code.

3. **Modularity**: Terraform modules enable reusable components that AI can leverage.

4. **Plan and apply workflow**: The plan output can be used to verify that the written Terraform code is valid before it's applied.

5. **Explicit error messages**: Terraform provides clear and detailed error messages that AI assistants can parse and understand.

Let's look at how this works in practice with CaboFit.

## Case Study: Some CaboFit Terraform

Let's say you have a [javascript file](https://github.com/Harrolee/cabo/blob/d800b001b7de63839c505935c980f2383d0c5ef0/functions/motivational-images/index.js) that sends an LLM-generated text message to a user. Let's say you want to send that message once a day every day at 9am. The very existence of Terraform, indeed, _any_ IaC tool, means that you can describe this desired end state in code. Now that Cursor/Windsurf/Cline exist, you can simply describe the desired end state, and the tool will generate the Terraform code to achieve that end state.

This is the important part: Your AI assistant can know the current state of your deployed infrastructure, and when you express a passing wish, it can generate the IaC to satisfy your desire.

And when it doesn't work, you can show it the error message and ask it to write better IaC.

Here's some of [CaboFit's Terraform](https://github.com/Harrolee/cabo/blob/d800b001b7de63839c505935c980f2383d0c5ef0/_infra/main.tf#L1):

```hcl
# Configure the Google Cloud provider
provider "google" {
  project = var.project_id
  region  = var.region
}

# Create a Cloud Storage bucket for the function source
resource "google_storage_bucket" "function_bucket" {
  name     = "${var.project_id}-function-source"
  location = var.region
  uniform_bucket_level_access = true
}

# Cloud Scheduler configuration
resource "google_cloud_scheduler_job" "daily_motivation" {
  name        = "trigger-daily-motivation"
  description = "Triggers the motivation function daily"
  schedule    = "0 9 * * *"
  time_zone   = "America/New_York"

  http_target {
    http_method = "POST"
    uri         = module.motivation_function.url

    oidc_token {
      service_account_email = google_service_account.function_invoker.email
    }
  }
}
```
This configuration defines the cloud provider (the part that connects Terraform to GCP), the storage bucket that houses our business logic, and the scheduled job that sends a picture pair every morning.

![picture of a swooning schoolboy with Lee's face](/images/swoon-lee.png)

Are you in love yet? The feeling will never fade.

## Features That Make Cabo AI-Friendly

At a high level, CaboFit is six cloud functions, two buckets, and a sign-up SPA in a trench coat. Okay, there's also a Twilio phone number and a Stripe account. But you get the idea. Let's look at how this architecture makes it easy for an AI assistant to understand and modify the codebase, and how it suits an app whose LLM calls need to track both a user's conversation history and the current definition of a coach persona in order to deliver a cohesive customer experience.

### 1. Modular Cloud Functions

Cabo uses a collection of specialized cloud functions, each with a single responsibility:

```
functions/
├── get-user-data/
├── motivational-images/
├── process-sms/
├── signup/
├── stripe-webhook/
├── create-stripe-subscription/
├── create-setup-intent/
└── shared/
    └── coach-personas.js
```

This modular approach allows an AI assistant to focus on one function at a time, making it easier to understand and modify the codebase.

### 2. Infrastructure as Code with Terraform

The entire infrastructure is defined in Terraform, making it transparent and reproducible:

```hcl
# Create ZIP archives for each function
data "archive_file" "motivational_images_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../functions/motivational-images"
  output_path = "${path.root}/tmp/motivational-images.zip"
  excludes    = ["node_modules"]
}

# More function archives...
```

This approach allows an AI assistant to understand how each function is packaged and deployed.

### 3. Shared Code and Configuration

The project uses a shared module for the information that every LLM call needs to have. For example, the `coach-personas.js` file defines different coaching styles:

```javascript
const COACH_PERSONAS = {
  zen_master: {
    name: "Zen Master",
    description: "A peaceful, mindful coach focused on holistic wellness and inner strength",
    traits: [
      "Radiates peaceful zen energy",
      "Uses phrases like 'Listen to your body' and 'Every step counts'",
      "Emphasizes mindfulness and balance",
      "Often references nature and harmony",
      "Ends messages with 'Namaste' or gentle encouragement"
    ],
    // ...
  },
  // Other personas...
};
```

When I decide, arbitrarily, that I want to make the frat_bro coach somehow more aggressive, I can type into a natural-language IDE pane and watch an AI-assistant change code that is defined only in one place in order to change the behavior of the frat_bro coach in every function that needs to know about the frat_bro coach.

## How AI Assistants Leverage This Architecture

With this foundation in place, an AI assistant can perform several deployment-related tasks:

1. **Create new cloud functions**: By understanding the existing patterns, an AI can generate new functions that follow the same structure.

2. **Update infrastructure**: When new requirements emerge, the AI can modify the Terraform configurations to add or update resources.

3. **Deploy changes**: Using the Terraform workflow, the AI can plan and apply changes to the infrastructure.

4. **Fix problems**: By examining logs and error messages, the AI can identify and troubleshoot deployment issues.

## Improving AI-Strength: Can we make CaboFit fit for Cabo?

### Ken Erwin's End of Human-Readable Code

Developing CaboFit with Cursor's Composer and Claude is already more fun than a bucket of pull-tabs, but I recently read Ken Erwin's article ["The End of Human-Readable Code: It's Time to Write for AI"](https://www.linkedin.com/pulse/end-human-readable-code-its-time-write-ai-ken-erwin-papmc/) and learned several improvements that could make the party rage even harder. This include:

1. **Context headers**: Clear file-level documentation that explains system context, business rules, and technical dependencies.

2. **Semantic grouping**: Explicit section markers that help AI models understand code organization.

3. **Relationship markers**: Clear indicators of code relationships between different parts of the system.

4. **Type information**: Explicit type hints and schemas that help AI understand data structures. So, **not** javascript.

Implementing these practices in CaboFit would make it even easier for AI assistants to understand and modify the codebase. Enhanced Documentation for the process-sms function might look like this:

```markdown
# Function: process-sms

## Purpose
Processes incoming SMS messages from users and generates appropriate responses.

## Inputs
- From: Phone number of the sender
- Body: Content of the SMS message

## Outputs
- SMS response to the user
- Updated conversation history in storage

## Dependencies
- Twilio API for SMS handling
- OpenAI API for response generation
- Cloud Storage for conversation history
```
Thanks Ken!

### Geoffrey Huntley Calls Me Out

I learned about [yolo mode](https://forum.cursor.com/t/yolo-mode-is-amazing/36262) last week. 

Huntley points out that developers like me underutilize Cursor by treating it as regular old IDE rather than an autonomous agent. Sorta like how I use my paring blade to cut literally everything. Instead, Huntley says we should use Cursor to create new [rules](https://docs.cursor.com/context/rules-for-ai) that Cursor will then follow during yolo mode. Read his [article](https://ghuntley.com/stdlib/) for a better explanation. 

To take full advantage of Cursor's capabilities, I could:

1. **Create more and better Cursor rules**: These rules would enforce coding standards, architectural decisions, and other best practices. My [meager ruleset](https://github.com/Harrolee/cabo/tree/main/.cursor/rules) currently includes "any time you add a dependency to a cloud function, add it the function's package.json" and "any time you create a terraform object that interacts with another object, make sure it has the permissions to do so". I ought to review this list of [awesome Cursor rules](https://github.com/PatrickJS/awesome-cursorrules) from PatrickJS.

2. **Actually use the tool (enable yolo mode)**: I've been treating Cursor as a pair programming partner. I ought to treat Cursor as a genie.

3. **Implement a feedback loop with tests and a dev environment**: As an infrastructure junkie, I've dishonored myself by writing an app with only one deployment environment and no tests. Shame on me. 
![shameful screenshot of the branch dropdown in GitHub showing that the add-dev-env branch exists in addition to the main branch](shame.png)
caption:_Please nobody tell Steven Kneisler. I'll be so ashamed. Please._

With that out of the way, if I wrote some bash to make calls to CaboFit's cloud functions in a dev environment and then curled their logs, Claude could use the output to make sure it does not break the app when deploying changes. Or, instead of writing a script to curl logs from the cloud, I could make log-retrieval a capability of the AI assistant agent itself. I could give my autonomous genie superpowers by writing an [Anthropic MCP server](https://docs.anthropic.com/en/docs/agents-and-tools/mcp) that retrieves and analyzes cloud function logs:

```javascript
// log-analyzer.js
const { CloudFunctionsServiceClient } = require('@google-cloud/functions');
const { Claude } = require('@anthropic/sdk');

async function analyzeLogs(functionName) {
  // Retrieve logs from Cloud Functions
  const client = new CloudFunctionsServiceClient();
  const logs = await client.getLogs(functionName);
  
  // Analyze logs with Claude
  const claude = new Claude({
    apiKey: process.env.CLAUDE_API_KEY,
  });
  
  const analysis = await claude.messages.create({
    model: "claude-3-opus-20240229",
    system: "You are a log analysis expert. Identify patterns, errors, and optimization opportunities.",
    messages: [
      {
        role: "user",
        content: `Analyze these cloud function logs and provide insights:\n\n${logs}`
      }
    ],
    max_tokens: 1000
  });
  
  return analysis.content;
}
```

## Conclusion: The Autonomous Development Future

The future is wild. I haven't slept in a while. I'm not sure if I'm dreaming.

The combination of AI-assisted development and deployment represents a significant leap forward in software engineering productivity. By structuring projects with AI-friendly patterns and leveraging tools like Terraform, we're moving toward a future where AI assistants can handle increasingly complex aspects of the software lifecycle.

Cabo's architecture demonstrates how a modern cloud application can be structured to facilitate this approach. With continued improvements in documentation, testing, and AI-optimized code patterns, the project could become even more amenable to AI assistance.

As we look to the future, the line between development and operations will continue to blur, with AI assistants playing a central role in both domains. The result will be faster iteration cycles, more reliable deployments, and ultimately, better software for end users.

The next frontier isn't just about writing code—it's about building and evolving entire systems with AI as a true partner in the process. For my part, I'm excited to create more systems that are AI-friendly, and to use AI to make more systems.

---

What aspects of AI-assisted deployment are you most excited about? Have you structured your projects to be AI-friendly? Give me ashout on [LinkedIn](https://www.linkedin.com/in/lee-harrold/) and let me know!

![picture of an ogre with Lee's face waving goodbye](ogre_before.PNG)
Did you forget about the ogre? I didn't.