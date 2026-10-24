import { create } from "zustand";
import { AgentConversation } from "../core/agent/AgentConversation";
import { ModelError } from "../core/agent/model";
import { useApp } from "./stores";
import { DesktopAgentModel, loadAgentSettings, modelConfig, saveAgentSettings, type AgentSettings } from "./agentModel";

interface ChatState {
  settings: AgentSettings;
  conversation: AgentConversation | null;
  preparing: boolean;
}
/** Lives outside the view: opening radio or navigating away does not lose the active turn. */
export const useAgentChat = create<ChatState>(() => ({ settings: loadAgentSettings(), conversation: null, preparing: false }));
let generation = 0;

useApp.subscribe((state, previous) => {
  if (state.agentSession !== previous.agentSession && previous.agentSession) {
    generation++;
    useAgentChat.getState().conversation?.dispose();
    useAgentChat.setState({ conversation: null });
  }
});

export async function openAgentChat(): Promise<AgentConversation> {
  const state = useAgentChat.getState();
  if (state.conversation) return state.conversation;
  if (state.preparing) throw new ModelError("cancelled");
  const current = generation;
  const model = new DesktopAgentModel(modelConfig(state.settings), { readOnly: state.settings.readOnly });
  useAgentChat.setState({ preparing: true });
  try {
    const executor = await useApp.getState().openAgentSession();
    if (generation !== current) throw new ModelError("cancelled");
    const conversation = new AgentConversation(model, executor, { readOnly: state.settings.readOnly, compactContext: modelConfig(state.settings).structuredOutput });
    useAgentChat.setState({ conversation });
    return conversation;
  } finally { useAgentChat.setState({ preparing: false }); }
}

export async function resetAgentChat(settings?: AgentSettings): Promise<void> {
  if (useAgentChat.getState().preparing) throw new ModelError("cancelled");
  // Validate/persist before touching a working conversation. No secrets in this storage.
  if (settings) saveAgentSettings(settings);
  generation++;
  const conversation = useAgentChat.getState().conversation;
  const executor = useApp.getState().agentSession;
  useAgentChat.setState({ preparing: true });
  conversation?.dispose();
  try {
    await executor?.whenIdle();
    if (useApp.getState().agentSession === executor) useApp.getState().closeAgentSession();
    useAgentChat.setState({ conversation: null, ...(settings ? { settings: structuredClone(settings) } : {}) });
  } finally { useAgentChat.setState({ preparing: false }); }
}
