import { MINIMAX_MODELS, PROVIDER_ORDER, PROVIDERS } from "../config/providers";
import type { useBigTtsController } from "../hooks/useBigTtsController";
import { Button, Checkbox, FieldPanel } from "./ui/Controls";
import { Icon } from "./ui/Icon";

type Controller = ReturnType<typeof useBigTtsController>;

export function ProviderSetup({ controller }: { controller: Controller }) {
  const { state, providerConfig, actions } = controller;
  const usesKey = providerConfig.authMode === "api-key";
  const credential = state.credentials[state.provider];
  const remembered = state.rememberCredential[state.provider];
  return <div className="provider-setup">
    <div className="field"><label className="field-label" htmlFor="provider">Provider</label>
      <select id="provider" value={state.provider} onChange={(event) => actions.selectProvider(event.target.value as keyof typeof PROVIDERS)}>
        {PROVIDER_ORDER.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
      </select>{providerConfig.accessDescription && <small className="field-help">{providerConfig.accessDescription}</small>}</div>
      {usesKey && <div className="credential-block">
        {remembered ? <div className="credential-saved">
          <Checkbox id="rememberKey" label={`${providerConfig.credentialLabel} kept for this browser session`} checked onChange={(event) => actions.setRememberCredential(event.target.checked)} />
        </div> : <div className="credential-entry">
          <label id="apiKeyLabel" className="field" htmlFor="apiKey"><span className="field-label">{providerConfig.credentialLabel}</span>
            <input id="apiKey" type="password" autoComplete="off" placeholder={providerConfig.credentialPlaceholder} value={credential} onChange={(event) => actions.setCredential(event.target.value)} />
          </label>
          <Button type="button" className="remember-action" disabled={!credential.trim()} onClick={() => actions.setRememberCredential(true)}><Icon name="key" />Keep for session</Button>
        </div>}
      </div>}
    {providerConfig.supportsBalance && <ProviderBalance controller={controller} />}

    {state.provider === "openrouter" && <OpenRouterSetup controller={controller} />}
    {state.provider === "minimax" && <MiniMaxSetup controller={controller} />}
    {state.provider === "google" && <GoogleSetup controller={controller} />}
  </div>;
}

function OpenRouterSetup({ controller }: { controller: Controller }) {
  const { state, actions } = controller;
  return <>
    <FieldPanel id="openrouterModelPanel" className="provider-model-panel" live>
      <label htmlFor="openrouterModel">OpenRouter model</label>
      <select id="openrouterModel" value={state.openrouterModel} disabled={!state.credentials.openrouter || !state.openrouterModels.length} onChange={(event) => actions.selectOpenRouterModel(event.target.value)}>
        {!state.credentials.openrouter && <option value="">Enter an OpenRouter API key to load models</option>}
        {state.credentials.openrouter && !state.openrouterModels.length && <option value="">Loading OpenRouter speech models...</option>}
        {state.openrouterModels.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
      </select>
      <span>{state.credentials.openrouter ? "Choose the OpenRouter speech model and voice used for narration." : "Models and voices load after your API key is entered."}</span>
    </FieldPanel>
  </>;
}

function ProviderBalance({ controller }: { controller: Controller }) {
  const { state } = controller;
  const balance = state.providerBalance;
  if (!balance?.available || typeof balance.amount !== "number") return null;
  const value = new Intl.NumberFormat(undefined, { style: "currency", currency: balance.currency || "USD" }).format(balance.amount);
  const detail = balance.message || (balance.updatedAt ? `Updated ${new Date(balance.updatedAt).toLocaleTimeString()}` : "Refreshes after every generated segment.");
  return <div className="provider-balance" aria-label="Provider balance" aria-live="polite">
    <div className="balance-head"><span className="status-dot status-available" aria-hidden="true" /><span>Available balance</span></div>
    <strong className="balance-value">{value}</strong>
    <small className="balance-detail">{detail}</small>
  </div>;
}

function MiniMaxSetup({ controller }: { controller: Controller }) {
  const { state, actions } = controller;
  return (
    <FieldPanel id="minimaxModelPanel" className="provider-model-panel" live>
      <label htmlFor="minimaxModel">MiniMax speech model</label>
      <select id="minimaxModel" value={state.minimaxModel} onChange={(event) => actions.setMinimaxModel(event.target.value)}>{MINIMAX_MODELS.map((model) => <option key={model}>{model}</option>)}</select>
      <span>Choose the MiniMax model used for narration.</span>
    </FieldPanel>
  );
}

function GoogleSetup({ controller }: { controller: Controller }) {
  const { state, actions } = controller;
  const auth = state.googleOAuth;
  return <FieldPanel id="googleAuthPanel" className="google-auth-panel" live>
    <div><strong>{auth.connected ? "Google connected" : auth.configured ? "Google OAuth ready" : "Google OAuth is not configured"}</strong><span>{auth.error || (auth.connected ? `Connected locally${auth.updatedAt ? ` · updated ${new Date(auth.updatedAt).toLocaleString()}` : ""}.` : auth.redirectUri || "Add Google OAuth credentials to the local environment.")}</span></div>
    <div className="google-auth-actions"><Button type="button" disabled={!auth.configured} onClick={actions.connectGoogle}>Connect Google</Button><Button type="button" disabled={!auth.connected} onClick={() => void actions.disconnectGoogle()}>Disconnect</Button></div>
  </FieldPanel>;
}
