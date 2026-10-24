// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("../app/agentChat", () => ({ useAgentChat: vi.fn(), openAgentChat: vi.fn(), resetAgentChat: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(false) }));
import { invoke } from "@tauri-apps/api/core";
import { useAgentChat, openAgentChat, resetAgentChat } from "../app/agentChat";
import { defaultAgentSettings } from "../app/agentModel";
import { AgentConversation } from "../core/agent/AgentConversation";
import { AgentExecutor, type AgentToolHandler } from "../core/agent/AgentExecutor";
import { I18nProvider } from "./I18nContext";
import { AgentView } from "./AgentView";
import { setLocale } from "../core/i18n";

let chat: AgentConversation;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); setLocale("en");
  const settings = defaultAgentSettings(); settings.local.model = "fixture";
  chat = new AgentConversation({ complete: async () => '{"type":"answer","message":"Hello from model"}' }, new AgentExecutor({ run: vi.fn<AgentToolHandler["run"]>(), clear: () => {} }));
  vi.mocked(useAgentChat).mockReturnValue({ settings, conversation: chat, preparing: false });
  vi.mocked(openAgentChat).mockResolvedValue(chat);
  vi.mocked(resetAgentChat).mockResolvedValue();
});
afterEach(() => { cleanup(); chat.dispose(); });
const mount = () => render(<I18nProvider><AgentView /></I18nProvider>);

describe("desktop agent chat UI", () => {
  it("renders conversation responses as text and sends only on submit", async () => {
    mount();
    expect(openAgentChat).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "What should Wave do?" }), { target: { value: "Hello <script>" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Hello from model");
    expect(screen.getByText("Hello <script>")).toBeTruthy();
    expect(document.querySelector(".agent-messages script")).toBeNull();
  });
  it("keeps cloud disabled until selected and consented, stores keys only through native IPC", async () => {
    mount();
    fireEvent.click(screen.getByText(/^Model connection ·/));
    fireEvent.change(screen.getByLabelText("Model connection"), { target: { value: "cloud" } });
    const consent = screen.getByRole("checkbox", { name: /Send my messages/ }) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    fireEvent.change(screen.getByLabelText("API base URL"), { target: { value: "https://api.example/v1" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agent_key_save", { baseUrl: "https://api.example/v1", key: "test-secret" }));
    await waitFor(() => expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(""));
    expect(JSON.stringify(localStorage)).not.toContain("test-secret");
    expect(openAgentChat).not.toHaveBeenCalled();
  });
  it("prevents sending to old settings while edits are unapplied", () => {
    mount();
    fireEvent.click(screen.getByText(/^Model connection ·/));
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "different" } });
    fireEvent.change(screen.getByRole("textbox", { name: "What should Wave do?" }), { target: { value: "test" } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Settings have changed/)).toBeTruthy();
  });
});
