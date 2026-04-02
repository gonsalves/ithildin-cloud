import Anthropic from '@anthropic-ai/sdk';

export interface ProcessingResult {
  content: string;
  tokensUsed: number;
}

export class ClaudeClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /** Process a daily note — returns the processed note content (everything below the divider) */
  async processDailyNote(opts: {
    systemPrompt: string;
    dailyNote: string;
    vaultContext: string;
  }): Promise<ProcessingResult> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: opts.systemPrompt,
      messages: [{
        role: 'user',
        content: `Here is today's daily note:\n\n${opts.dailyNote}\n\n---\n\nVault context:\n${opts.vaultContext}`,
      }],
    });

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => b.type === 'text' ? b.text : '')
      .join('');

    return {
      content,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
  }

  /** Generate a literature note from fetched article content */
  async generateLiteratureNote(opts: {
    systemPrompt: string;
    url: string;
    articleContent: string;
    vaultTags: string;
  }): Promise<ProcessingResult> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: opts.systemPrompt,
      messages: [{
        role: 'user',
        content: `URL: ${opts.url}\n\nFetched content:\n${opts.articleContent}\n\nExisting vault tags:\n${opts.vaultTags}`,
      }],
    });

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => b.type === 'text' ? b.text : '')
      .join('');

    return {
      content,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
  }

  /** Generate a product note from fetched product page */
  async generateProductNote(opts: {
    systemPrompt: string;
    url: string;
    pageContent: string;
    vaultTags: string;
  }): Promise<ProcessingResult> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: opts.systemPrompt,
      messages: [{
        role: 'user',
        content: `URL: ${opts.url}\n\nProduct page content:\n${opts.pageContent}\n\nExisting vault tags:\n${opts.vaultTags}`,
      }],
    });

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => b.type === 'text' ? b.text : '')
      .join('');

    return {
      content,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
  }

  /** Generate an event note from fetched event page */
  async generateEventNote(opts: {
    systemPrompt: string;
    url: string;
    pageContent: string;
  }): Promise<ProcessingResult> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: opts.systemPrompt,
      messages: [{
        role: 'user',
        content: `URL: ${opts.url}\n\nEvent page content:\n${opts.pageContent}`,
      }],
    });

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => b.type === 'text' ? b.text : '')
      .join('');

    return {
      content,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
  }

  /** Generate the vault digest (digest + connections + gaps) in a single call */
  async generateDigest(opts: {
    systemPrompt: string;
    vaultContext: string;
  }): Promise<ProcessingResult> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 12000,
      system: opts.systemPrompt,
      messages: [{
        role: 'user',
        content: opts.vaultContext,
      }],
    });

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => b.type === 'text' ? b.text : '')
      .join('');

    return {
      content,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
  }
}
