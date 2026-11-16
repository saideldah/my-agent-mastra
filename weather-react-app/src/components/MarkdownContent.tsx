import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h4>{children}</h4>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h5>{children}</h5>,
  h4: ({ children }) => <h6>{children}</h6>,
  h5: ({ children }) => <h6>{children}</h6>,
  h6: ({ children }) => <h6>{children}</h6>,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border bg-[var(--card)] my-2" tabIndex={0}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b bg-[var(--surface-subtle)]">{children}</thead>,
  th: ({ children }) => (
    <th
      scope="col"
      className="px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-secondary)]"
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3.5 py-2.5 text-[var(--ink-primary)] align-top border-b last:border-b-0">
      {children}
    </td>
  ),
  pre: ({ children }) => (
    <pre className="code-pre code-scroll my-2" tabIndex={0}>
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[var(--accent-cobalt)] underline underline-offset-2"
    >
      {children}
    </a>
  ),
};

export function MarkdownContent({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  if (!content.trim()) return null;

  return (
    <div className={`markdown-prose ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
