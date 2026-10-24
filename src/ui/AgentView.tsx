import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openAgentChat, resetAgentChat, useAgentChat } from "../app/agentChat";
import { testModelConnection, type AgentSettings } from "../app/agentModel";
import type { AgentConversation, ConversationState } from "../core/agent/AgentConversation";
import { modelErrorCode } from "../core/agent/model";
import { useI18n } from "./I18nContext";
import { agentErrorText, agentText, agentToolError, agentToolLabel } from "./agentText";
import "./agent.css";

const EMPTY: ConversationState = { events: [], busy: false, uncertain: false };
const subscribeEmpty = () => () => {};
const emptySnapshot = () => EMPTY;
function useConversation(conversation: AgentConversation | null) {
  return useSyncExternalStore(conversation?.subscribe ?? subscribeEmpty, conversation?.getSnapshot ?? emptySnapshot);
}

export function AgentView() {
  const { locale } = useI18n();
  const t = agentText(locale);
  const { settings, conversation, preparing } = useAgentChat();
  const state = useConversation(conversation);
  const [draft, setDraft] = useState<AgentSettings>(() => structuredClone(settings));
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  const [operation, setOperation] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const testing = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const busy = preparing || operation || state.busy;
  const selected = draft[draft.mode];
  const patchConnection = (patch: Partial<typeof selected>) => setDraft((value) => ({ ...value, [value.mode]: { ...value[value.mode], ...patch } }));

  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [state.events.length, state.busy]);
  useEffect(() => () => testing.current?.abort(), []);
  useEffect(() => {
    let current = true;
    if (draft.mode === "cloud" && draft.cloud.baseUrl === settings.cloud.baseUrl && settings.cloud.baseUrl) {
      void invoke<boolean>("agent_key_present", { baseUrl: settings.cloud.baseUrl }).then((value) => {
        if (current) setKeyPresent(value);
      }).catch(() => { if (current) setKeyPresent(null); });
    }
    return () => { current = false; };
  }, [draft.mode, draft.cloud.baseUrl, settings.cloud.baseUrl]);

  async function act(action: () => Promise<void>) {
    setOperation(true); setNotice("");
    try { await action(); } catch (error) { setNotice(agentErrorText(modelErrorCode(error), locale)); }
    finally { setOperation(false); }
  }
  async function send() {
    if (!text.trim() || busy || dirty) return;
    const message = text;
    setNotice("");
    try {
      const chat = await openAgentChat();
      setText("");
      await chat.send(message);
    } catch (error) { setNotice(agentErrorText(modelErrorCode(error), locale)); }
  }

  return <section className="agent-view">
    <header className="agent-heading"><div><h1>{t.title}</h1><p>{t.intro}</p></div>
      <button className="btn" disabled={preparing || operation} onClick={() => void act(() => resetAgentChat())}>{t.newChat}</button>
    </header>
    <details className="agent-settings" open={!settings[settings.mode].model || undefined}>
      <summary>{t.settings} · {settings.mode === "local" ? t.local : t.cloud} · {settings.readOnly ? t.read : t.control}</summary>
      <fieldset disabled={busy}>
        <label>{t.settings}<select value={draft.mode} onChange={(e) => { setKey(""); setKeyPresent(null); setDraft({ ...draft, mode: e.target.value as AgentSettings["mode"] }); }}>
          <option value="local">{t.local}</option><option value="cloud">{t.cloud}</option>
        </select></label>
        <p>{draft.mode === "local" ? t.localHint : t.cloudHint}</p>
        <label>{t.server}<input type="url" spellCheck={false} autoComplete="off" value={selected.baseUrl} maxLength={2048}
          onChange={(e) => { patchConnection({ baseUrl: e.target.value }); setKey(""); setKeyPresent(null); if (draft.mode === "cloud") setDraft((v) => ({ ...v, cloudConsent: false })); }} placeholder={draft.mode === "local" ? "http://127.0.0.1:11434/v1" : "https://…/v1"} /></label>
        <label>{t.model}<input value={selected.model} maxLength={200} spellCheck={false} autoComplete="off" onChange={(e) => patchConnection({ model: e.target.value })} /></label>
        {draft.mode === "cloud" && <>
          <label className="agent-check"><input type="checkbox" checked={draft.cloudConsent} onChange={(e) => setDraft({ ...draft, cloudConsent: e.target.checked })} />{t.consent}</label>
          <label>{t.key}<input type="password" value={key} maxLength={4096} autoComplete="new-password" spellCheck={false} onChange={(e) => setKey(e.target.value)} /></label>
          <p>{t.keyHint}</p>
          {keyPresent !== null && <p>{keyPresent ? t.keyPresent : t.keyAbsent}</p>}
          <div className="agent-actions">
            <button className="btn" disabled={!key || !draft.cloud.baseUrl} onClick={() => void act(async () => {
              await invoke("agent_key_save", { baseUrl: draft.cloud.baseUrl, key }); setKey(""); setKeyPresent(true); setNotice(t.keyPresent);
            })}>{t.keySave}</button>
            <button className="btn" disabled={!draft.cloud.baseUrl} onClick={() => void act(async () => {
              await invoke("agent_key_delete", { baseUrl: draft.cloud.baseUrl }); setKey(""); setKeyPresent(false); setNotice(t.keyDeleted);
            })}>{t.keyDelete}</button>
          </div>
        </>}
        <label className="agent-check"><input type="checkbox" checked={draft.readOnly} onChange={(e) => setDraft({ ...draft, readOnly: e.target.checked })} />{t.readOnly}</label>
        <label className="agent-check"><input type="checkbox" checked={selected.jsonMode} onChange={(e) => patchConnection({ jsonMode: e.target.checked })} />{t.jsonMode}</label>
        <label>{t.tokenParameter}<select value={selected.tokenParameter} onChange={(e) => patchConnection({ tokenParameter: e.target.value as typeof selected.tokenParameter })}>
          <option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option>
        </select></label>
        <div className="agent-actions">
          <button className="btn btn-primary" onClick={() => void act(async () => { await resetAgentChat(draft); setNotice(t.saved); })}>{t.save}</button>
          <button className="btn" onClick={() => void act(async () => {
            const controller = new AbortController(); testing.current = controller; setIsTesting(true);
            try { await testModelConnection(draft, controller.signal); setNotice(t.tested); }
            finally { testing.current = null; setIsTesting(false); }
          })}>{t.test}</button>
        </div>
      </fieldset>
    </details>
    {dirty && <p className="agent-notice">{t.draft}</p>}
    {notice && <p className="agent-notice" role="status">{notice}</p>}
    <div className="agent-messages" role="log" aria-label={t.title} aria-live="polite" aria-relevant="additions text">
      {state.events.length === 0 && <p className="agent-empty">{t.empty}</p>}
      {state.events.map((event, index) => <article key={index} className={`agent-message agent-message-${event.type}`}>
        <strong>{event.type === "user" ? t.user : event.type === "assistant" ? t.assistant : t.tool}</strong>
        {event.type === "user" && <p>{event.text}</p>}
        {event.type === "assistant" && <p>{event.decision.message}</p>}
        {event.type === "error" && <p>{agentErrorText(event.code, locale)}</p>}
        {event.type === "tool" && <>
          <p>{agentToolLabel(event.call.name, locale)}: {event.result.ok ? t.success : event.result.error.effect === "unknown" ? t.unknown : agentToolError(event.result.error.code, locale)}</p>
          <details><summary>{t.details}</summary><pre>{JSON.stringify({ arguments: event.call.args, result: event.result }, null, 2)}</pre></details>
        </>}
      </article>)}
      <div ref={end} />
    </div>
    {state.uncertain && <div className="agent-notice"><p>{t.unknown}</p><button className="btn" onClick={() => {
      if (!conversation?.reconcile()) setNotice(t.unknown);
    }}>{t.refresh}</button></div>}
    <form className="agent-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea aria-label={t.placeholder} placeholder={t.placeholder} maxLength={2000} rows={3} value={text}
        onChange={(e) => setText(e.target.value)} disabled={preparing || operation}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div className="agent-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || dirty || state.uncertain || !text.trim()}>{t.send}</button>
        <button className="btn" type="button" disabled={!state.busy && !isTesting} onClick={() => { conversation?.cancel(); testing.current?.abort(); }}>{t.stop}</button>
        {(state.busy || preparing || operation) && <span role="status">{state.busy ? t.busy : t.preparing}</span>}
      </div>
      <small>{t.stopHint}</small>
    </form>
  </section>;
}
