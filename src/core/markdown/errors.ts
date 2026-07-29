/**
 * Error types for the markdown knowledge base subsystem.
 *
 * Kept separate from cgraphx's main error types so the subsystem can be
 * removed without touching the rest of the project.
 */

export class MarkdownIndexError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MarkdownIndexError';
  }
}

export class SchemaMismatchError extends MarkdownIndexError {
  constructor(expected: number, actual: number) {
    super(
      `Markdown subsystem schema mismatch: expected version ${expected}, found ${actual}. ` +
        `Run \`cgraphx docs index\` to apply the latest schema.`,
    );
    this.name = 'SchemaMismatchError';
  }
}

export class DocumentNotFoundError extends MarkdownIndexError {
  constructor(public readonly queriedIdOrPath: string) {
    super(`Document not found: ${queriedIdOrPath}`);
    this.name = 'DocumentNotFoundError';
  }
}

export class ProjectNotInitializedError extends MarkdownIndexError {
  constructor(public readonly projectPath: string) {
    super(
      `cgraphx not initialized at ${projectPath}. Run \`cgraphx install\` first.`,
    );
    this.name = 'ProjectNotInitializedError';
  }
}
