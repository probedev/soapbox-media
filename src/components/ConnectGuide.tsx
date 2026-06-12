"use client";

/**
 * The drop-dead-simple, non-technical-first MCP setup walkthrough used on
 * /connect (and reusable elsewhere). Leads with the point-and-click connector
 * flow for Claude and ChatGPT; developer config files live in their own tab.
 */
import type { ReactNode } from "react";

import { CopyField } from "@/components/CopyField";
import { SubscribeButton } from "@/components/SubscribeButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ENDPOINT = "https://www.soapbox.media/api/mcp/mcp";

const STARTER_PROMPTS = [
  "What moved this week in political media? Give me the three biggest swings with the sharpest quote from each side, with links.",
  "How are independent vs legacy shows framing immigration over the last 30 days, and where do they diverge?",
  "Which issues surged in mention volume in the last two weeks? Show the top five and who drove each.",
];

const CLAUDE_CODE = `claude mcp add --transport http soapbox ${ENDPOINT}`;

const CURSOR_JSON = `// .cursor/mcp.json
{
  "mcpServers": {
    "soapbox": { "url": "${ENDPOINT}" }
  }
}`;

const VSCODE_JSON = `// .vscode/mcp.json
{
  "servers": {
    "soapbox": { "type": "http", "url": "${ENDPOINT}" }
  }
}`;

const CLAUDE_DESKTOP_JSON = `// claude_desktop_config.json (Settings -> Developer -> Edit Config)
{
  "mcpServers": {
    "soapbox": {
      "command": "npx",
      "args": ["mcp-remote", "${ENDPOINT}"]
    }
  }
}`;

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex items-center justify-center w-8 h-8 shrink-0 rounded-full bg-primary text-white text-sm font-semibold">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-semibold leading-8">{title}</h3>
        <div className="mt-2 space-y-3 text-ink-body leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function NumberedList({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal pl-5 space-y-1.5 text-sm text-ink-body leading-relaxed">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

export function ConnectGuide() {
  return (
    <div className="space-y-9">
      <Step n={1} title="Get your Soapbox access">
        <p>
          Subscribe to MCP access. No account needed up front - you&apos;ll set a password in the
          next step.
        </p>
        <div className="rounded-md border border-border bg-subtle p-3 text-sm">
          <strong className="text-ink-strong">Have a beta invite code?</strong> On the Stripe
          checkout screen, click <em>Add promotion code</em>, paste your code, and your total drops
          to <strong>$0</strong>.
        </div>
        <SubscribeButton label="Subscribe - $300/mo" />
      </Step>

      <Step n={2} title="Set your password">
        <p>
          Right after checkout we email you a sign-in link. Click it, choose a password (at least 8
          characters), and your account is ready.
        </p>
        <p className="text-sm text-ink-muted">
          No email within a minute? Check your spam folder - it comes from our Soapbox account.
        </p>
      </Step>

      <Step n={3} title="Add the Soapbox connector to your AI app">
        <p>Copy this address - you&apos;ll paste it into your AI app once:</p>
        <CopyField value={ENDPOINT} label="MCP server URL" />
        <p className="text-sm text-ink-muted">
          Pick your app below. Menu names vary slightly by app and version, but every app keeps this
          under Settings.
        </p>
        <Tabs defaultValue="claude" className="w-full">
          <TabsList>
            <TabsTrigger value="claude">Claude</TabsTrigger>
            <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
            <TabsTrigger value="dev">Developer tools</TabsTrigger>
          </TabsList>

          <TabsContent value="claude" className="pt-2">
            <NumberedList
              items={[
                <>Open <strong>Settings</strong>, then <strong>Connectors</strong>.</>,
                <>Click <strong>Add custom connector</strong>.</>,
                <>Name it <strong>Soapbox</strong> and paste the address above into the URL field.</>,
                <>Click <strong>Add</strong>. Works the same on claude.ai and the Claude desktop app.</>,
              ]}
            />
          </TabsContent>

          <TabsContent value="chatgpt" className="pt-2">
            <NumberedList
              items={[
                <>Open <strong>Settings</strong>, then <strong>Connectors</strong> (you may need to turn on <strong>Developer mode</strong> first).</>,
                <>Click <strong>Create</strong> (or <strong>Add custom connector</strong>).</>,
                <>Paste the address above and name it <strong>Soapbox</strong>.</>,
                <>Click <strong>Save</strong>.</>,
              ]}
            />
          </TabsContent>

          <TabsContent value="dev" className="pt-2 space-y-4">
            <div>
              <p className="text-sm font-medium text-ink-strong mb-1.5">Claude Code</p>
              <CopyField value={CLAUDE_CODE} label="Claude Code command" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink-strong mb-1.5">Cursor</p>
              <CopyField value={CURSOR_JSON} label="Cursor config" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink-strong mb-1.5">VS Code (GitHub Copilot)</p>
              <CopyField value={VSCODE_JSON} label="VS Code config" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink-strong mb-1.5">Claude Desktop (config file)</p>
              <CopyField value={CLAUDE_DESKTOP_JSON} label="Claude Desktop config" />
            </div>
          </TabsContent>
        </Tabs>
        <p className="text-sm text-ink-muted">
          Heads up: custom connectors need a paid plan (Claude Pro, Max, or Team; ChatGPT Plus, Pro,
          or Business). They aren&apos;t available on free tiers.
        </p>
      </Step>

      <Step n={4} title="Sign in and approve">
        <p>
          The first time your app uses Soapbox, a browser window opens. Sign in with the email and
          password from Step 2, then click <strong>Approve</strong>. You only do this once - there
          is no key to copy or paste.
        </p>
      </Step>

      <Step n={5} title="Ask your first question">
        <p>You&apos;re connected. Type one of these straight into your AI app:</p>
        <div className="space-y-2">
          {STARTER_PROMPTS.map((p) => (
            <CopyField key={p} value={p} mono={false} label="example prompt" />
          ))}
        </div>
      </Step>

      <div className="border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Troubleshooting</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-ink-strong">No &ldquo;custom connector&rdquo; option?</dt>
            <dd className="text-ink-body">
              Custom connectors need a paid AI plan (Claude Pro/Max/Team, or ChatGPT
              Plus/Pro/Business). Free tiers can&apos;t add them.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-strong">Didn&apos;t get the password email?</dt>
            <dd className="text-ink-body">
              Check spam. It arrives within a minute of checkout from our Soapbox account.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-strong">Asked to sign in again?</dt>
            <dd className="text-ink-body">
              Your session expired - just sign in again with the same email and password.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-strong">Still stuck?</dt>
            <dd className="text-ink-body">Reply to the email we sent you and we&apos;ll help you get connected.</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
