// 知识库插件客户端能力的共享单例：设置界面、知识库页面共用同一套 api 与中文文案。
import { KnowledgeApi } from '../../../dsh-knowledge/src/ui/client/api';
import { zh, type Translate } from '../../../dsh-knowledge/src/ui/client/locales';

export const kbApi = new KnowledgeApi();

/** 只读中文词典：缺词回退到 key，不会因为语言服务没接上而崩 */
export const kbT = ((key: string) => (zh as Record<string, string>)[key] ?? key) as unknown as Translate;
