// Constants and shapes shared between the browser client and the Damlnaut
// backend. Everything here is safe to bundle into the browser.
//
// Local layout in dev:
//   Canton sandbox JSON Ledger API : http://localhost:7575  (canton sandbox --json-api-port 7575)
//   Damlnaut backend / verifier    : http://localhost:8787
//   Vite frontend                  : http://localhost:5173

export const DAML_JSON_API_URL_DEFAULT = 'http://localhost:7575';
export const DAMLNAUT_PACKAGE_NAME = 'daml-canton-ctf';
export const DAMLNAUT_ISSUER_HINT = 'damlnaut-issuer';
export const DAMLNAUT_PLAYER_HINT_PREFIX = 'damlnaut-player';
export const DAMLNAUT_USER_ID = 'damlnaut-app';
export const DAMLNAUT_NETWORK_ID = 'canton-localnet';
export const DAMLNAUT_PROVIDER_NAME = 'Canton Localnet (Daml SDK)';

// Module + entity names — matched against the Daml sources under daml/Damlnaut/.
export const MOD_LEVEL0 = 'Damlnaut.Level0';
export const MOD_FLAG_ISSUER = 'Damlnaut.FlagIssuer';
export const ENT_LEVEL0_INSTANCE = 'Level0Instance';
export const ENT_FLAG_ISSUER = 'FlagIssuer';
export const ENT_FLAG_PROOF = 'FlagProof';
export const ENT_FLAG = 'Flag';

export const CHOICE_SUBMIT_LEVEL0 = 'SubmitLevel0';
export const CHOICE_ISSUE_FLAG = 'IssueFlag';

export const LEVEL0_EXPECTED_PROOF = 'level-0-submitted';
export const LEVEL0_LEVEL_TAG = 'level-0';
export const LEVEL0_FLAG_VALUE = 'flag{daml_localnet_lvl0_ok}';

// Template-id builder. Daml 3.4's JSON Ledger API accepts package-name
// references of the form `#<packageName>:<Module>:<Entity>`.
export function templateId(module: string, entity: string): string {
  return `#${DAMLNAUT_PACKAGE_NAME}:${module}:${entity}`;
}

// -------- Ledger record shapes (subset used by the app) --------

export type Level0InstancePayload = {
  player: string;
  issuer: string;
  instanceId: string;
  instructions: string;
};

export type FlagIssuerPayload = {
  issuer: string;
  level: string;
  expectedProof: string;
  flagValue: string;
};

export type FlagProofPayload = {
  solver: string;
  issuer: string;
  level: string;
  instanceId: string;
  proof: string;
};

export type FlagPayload = {
  issuer: string;
  solver: string;
  level: string;
  instanceId: string;
  value: string;
};

export type Level0InstanceRecord = {
  contractId: string;
  templateId: string;
  payload: Level0InstancePayload;
};

export type FlagProofRecord = {
  contractId: string;
  templateId: string;
  payload: FlagProofPayload;
  updateId?: string;
};

export type FlagRecord = {
  contractId: string;
  templateId: string;
  payload: FlagPayload;
};

// -------- Backend API shapes --------

export type WalletConnectRequest = {
  partyIdHint?: string;
};

export type WalletConnectResponse = {
  party: string;
  jsonApiUrl: string;
  packageName: string;
  userId: string;
  networkId: string;
  providerName: string;
  issuer: string;
};

export type WalletResumeRequest = { party: string };

export type VerifyLevel0Request = {
  party: string;
};

export type VerifyLevel0Response = {
  proof: FlagProofRecord | null;
  flag: FlagRecord | null;
  verified: boolean;
  message: string;
};
