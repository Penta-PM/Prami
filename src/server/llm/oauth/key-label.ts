import { deployTarget } from '@/env-deploy';

/**
 * OAuth 로 발급되는 벤더 키의 라벨 (PRAMI-003 §4.4.3). OpenRouter auth URL 의 `key_label`(공식 문서: "Prefills the label of
 * the API key that will be created", 최대 100자)로 보내고, 연결 해제 안내에서 사용자가 대시보드에서 지울 키를 알아보게 한다.
 * 환경 이름만 담는다(사용자·이메일 없음).
 */
export type OAuthEnvName = 'production' | 'preview' | 'local';

export function oauthEnvName(
  source: Record<string, string | undefined> = process.env,
): OAuthEnvName {
  return deployTarget(source) ?? 'local';
}

export function oauthKeyLabel(envName: OAuthEnvName = oauthEnvName()): string {
  return `Prami (${envName})`;
}
