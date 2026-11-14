/** 将统一会话适配器连接到现有补录读取器接口。 */
import type { SessionReaderId } from '../../agents';
import { sessionAdapterContext, sessionAdapterFor } from './adapters';
import type { SessionFactsReader } from './types';

export function sessionFactsReader(readerId: SessionReaderId): SessionFactsReader {
  const adapter = sessionAdapterFor(readerId);
  return async (file, offset) => {
    const result = await adapter.readSessionFile(sessionAdapterContext(process.cwd()), file, offset);
    return { ...result, facts: [...result.facts] };
  };
}
