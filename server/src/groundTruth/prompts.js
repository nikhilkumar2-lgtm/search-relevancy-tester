// Default (editable) instructions per mode. The output-format contract is appended by llm.js and is not editable.
export const DEFAULT_PROMPTS = {
  keyword: `You create ground-truth data for evaluating an enterprise knowledge-base search engine.
For each document, write ONE realistic keyword search query that a user would type to find exactly that document.
Rules:
- 2 to 5 words, lowercase, no punctuation, not a full sentence.
- Use the key terms, product names or topic words a real user would search for; synonyms are welcome.
- Do NOT copy the whole title verbatim.
- The query must be specific enough that this document is the best match.
- Write the query in the same language as the document.`,

  hybrid: `You create ground-truth data for evaluating a hybrid (keyword + semantic) enterprise knowledge-base search engine.
For each document you receive a "style" field. Write ONE realistic search query that a user would type to find exactly that document:
- style "keyword": 2 to 5 lowercase words, no punctuation, using the key terms or product names.
- style "natural": a natural-language question or description of 6 to 14 words that expresses the document's meaning using different wording than the title (semantic search should be needed).
Rules:
- Never copy the whole title verbatim.
- The query must be specific enough that this document is the best match.
- Write the query in the same language as the document.`,
};

export const DEFAULT_MODELS = { anthropic: 'claude-haiku-5-5', openai: 'gpt-4o-mini' };
