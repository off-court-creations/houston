import React from "react";
import {
  Surface,
  Stack,
  Box,
  Typography,
  Button,
  Divider,
} from "@archway/valet";
import {
  postWorkspaceNew,
  getGithubAccounts,
  getGithubOwners,
} from "@/api/client";
import type { WorkspaceCreatePayload } from "@/api/types";
import { useNavigate } from "react-router-dom";

type RemoteMode = "none" | "existing" | "create";

type FormState = {
  directory: string;
  force: boolean;
  git: boolean;
  remoteMode: RemoteMode;
  remoteUrl: string;
  host: string;
  account: string | null;
  owner: string;
  repo: string;
  visibility: "private" | "public";
  push: boolean;
  authLabel: string;
};

const initialState: FormState = {
  directory: "./tracking",
  force: true,
  git: true,
  remoteMode: "none",
  remoteUrl: "",
  host: "github.com",
  account: null,
  owner: "",
  repo: "",
  visibility: "private",
  push: true,
  authLabel: "",
};

function buildCommandPreview(s: FormState): string {
  const parts = ["houston", "workspace", "new", s.directory];
  parts.push("--no-interactive");
  if (s.force) parts.push("--force");
  if (!s.git) parts.push("--no-git");
  if (s.remoteMode === "existing" && s.remoteUrl.trim()) {
    parts.push("--remote", s.remoteUrl.trim());
  } else if (s.remoteMode === "create" && s.owner.trim() && s.repo.trim()) {
    parts.push("--create-remote", `${s.owner.trim()}/${s.repo.trim()}`);
    if (s.host.trim() && s.host.trim() !== "github.com")
      parts.push("--host", s.host.trim());
    if (s.visibility === "public") parts.push("--public");
    else parts.push("--private");
  }
  if (s.push) parts.push("--push");
  if (s.authLabel.trim()) parts.push("--auth-label", s.authLabel.trim());
  return parts.join(" ");
}

function validate(s: FormState): string | null {
  if (!s.directory.trim()) return "Directory is required";
  if (s.remoteMode === "existing" && !s.remoteUrl.trim())
    return "Remote URL is required";
  if (s.remoteMode === "create") {
    if (!s.owner.trim()) return "Owner is required";
    if (!s.repo.trim()) return "Repository name is required";
    if (!/^[A-Za-z0-9_.-]+$/.test(s.repo.trim()))
      return "Repository name has invalid characters";
  }
  return null;
}

export default function NewWorkspacePage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState<FormState>(initialState);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    workspaceRoot: string;
  } | null>(null);
  const [accounts, setAccounts] = React.useState<
    Array<{ account: string; label: string }>
  >([]);
  const [owners, setOwners] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (state.remoteMode !== "create") return;
    getGithubAccounts(state.host).then((res) => {
      if (res.ok) setAccounts(res.accounts ?? []);
    });
  }, [state.remoteMode, state.host]);

  React.useEffect(() => {
    if (state.remoteMode !== "create") return;
    getGithubOwners(state.host, state.account ?? undefined).then((res) => {
      if (res.ok) setOwners(res.owners ?? []);
    });
  }, [state.remoteMode, state.host, state.account]);

  async function onSubmit(): Promise<void> {
    setError(null);
    const err = validate(state);
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    try {
      const payload: WorkspaceCreatePayload = {
        directory: state.directory,
        force: state.force,
        git: state.git,
        push: state.push,
      };
      if (state.authLabel.trim()) payload.authLabel = state.authLabel.trim();
      if (state.remoteMode === "existing" && state.remoteUrl.trim()) {
        payload.remoteUrl = state.remoteUrl.trim();
      } else if (state.remoteMode === "create") {
        payload.createRemote = `${state.owner.trim()}/${state.repo.trim()}`;
        payload.host = state.host.trim();
        payload.visibility = state.visibility;
      }

      const res = await postWorkspaceNew(payload);
      if (!res.ok) {
        setError(res.message || res.error || "Failed to create workspace");
        return;
      }
      const root = res.result?.workspaceRoot ?? state.directory;
      setSuccess({ workspaceRoot: root });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const preview = buildCommandPreview(state);

  return (
    <Surface>
      <Box alignX="center" centerContent>
        <Stack sx={{ gap: "1rem", width: "min(1000px, 100%)" }}>
          <Typography variant="h2">Create Houston Workspace</Typography>
          {error ? (
            <Typography sx={{ color: "#c62828" }}>{error}</Typography>
          ) : null}
          {success ? (
            <Box
              sx={{
                padding: "1rem",
                border: "1px solid #ddd",
                borderRadius: "8px",
              }}
            >
              <Typography variant="h4">Workspace ready</Typography>
              <Typography>Root: {success.workspaceRoot}</Typography>
              <Divider />
              <Typography>Next steps (terminal):</Typography>
              <pre style={{ margin: 0 }}>
                <code>houston workspace info</code>
              </pre>
              <div style={{ marginTop: 12 }}>
                <Button
                  variant="outlined"
                  onClick={() => navigate("/workspace/info")}
                >
                  Open Workspace Info
                </Button>
              </div>
            </Box>
          ) : (
            <>
              <Box
                sx={{
                  padding: "1rem",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                }}
              >
                <Typography variant="h4">Workspace</Typography>
                <Stack sx={{ gap: "0.75rem" }}>
                  <label>
                    <div>Directory</div>
                    <input
                      type="text"
                      placeholder="./tracking"
                      value={state.directory}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setState((s) => ({ ...s, directory: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={state.force}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setState((s) => ({
                          ...s,
                          force: Boolean(e.target.checked),
                        }))
                      }
                    />
                    <span style={{ marginLeft: 8 }}>
                      Overwrite existing contents (force)
                    </span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={state.git}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setState((s) => ({
                          ...s,
                          git: Boolean(e.target.checked),
                        }))
                      }
                    />
                    <span style={{ marginLeft: 8 }}>Initialize Git</span>
                  </label>
                </Stack>
              </Box>

              <Box
                sx={{
                  padding: "1rem",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                }}
              >
                <Typography variant="h4">Remote</Typography>
                <div role="radiogroup" aria-label="Remote mode">
                  <label style={{ marginRight: 16 }}>
                    <input
                      type="radio"
                      name="remoteMode"
                      value="none"
                      checked={state.remoteMode === "none"}
                      onChange={() =>
                        setState((s) => ({ ...s, remoteMode: "none" }))
                      }
                    />
                    <span style={{ marginLeft: 6 }}>No remote</span>
                  </label>
                  <label style={{ marginRight: 16 }}>
                    <input
                      type="radio"
                      name="remoteMode"
                      value="existing"
                      checked={state.remoteMode === "existing"}
                      onChange={() =>
                        setState((s) => ({ ...s, remoteMode: "existing" }))
                      }
                    />
                    <span style={{ marginLeft: 6 }}>Existing remote URL</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="remoteMode"
                      value="create"
                      checked={state.remoteMode === "create"}
                      onChange={() =>
                        setState((s) => ({ ...s, remoteMode: "create" }))
                      }
                    />
                    <span style={{ marginLeft: 6 }}>Create GitHub repo</span>
                  </label>
                </div>
                {state.remoteMode === "existing" ? (
                  <label>
                    <div>Remote URL</div>
                    <input
                      type="text"
                      placeholder="git@github.com:owner/repo.git"
                      value={state.remoteUrl}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setState((s) => ({ ...s, remoteUrl: e.target.value }))
                      }
                    />
                  </label>
                ) : null}
                {state.remoteMode === "create" ? (
                  <Stack sx={{ gap: "0.75rem" }}>
                    <label>
                      <div>GitHub Host</div>
                      <input
                        type="text"
                        placeholder="github.com"
                        value={state.host}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setState((s) => ({ ...s, host: e.target.value }))
                        }
                      />
                    </label>
                    <label>
                      <div>Account (optional)</div>
                      <select
                        value={state.account ?? ""}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                          setState((s) => ({
                            ...s,
                            account: e.target.value || null,
                          }))
                        }
                      >
                        <option value="">(none)</option>
                        {accounts.map((a) => (
                          <option key={a.account} value={a.account}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <div>Owner</div>
                      <input
                        type="text"
                        list="owner-suggestions"
                        placeholder="org-or-username"
                        value={state.owner}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setState((s) => ({ ...s, owner: e.target.value }))
                        }
                      />
                      <datalist id="owner-suggestions">
                        {owners.map((o) => (
                          <option key={o} value={o} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      <div>Repository name</div>
                      <input
                        type="text"
                        placeholder="my-repo"
                        value={state.repo}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setState((s) => ({ ...s, repo: e.target.value }))
                        }
                      />
                    </label>
                    <div role="radiogroup" aria-label="Visibility">
                      <label style={{ marginRight: 16 }}>
                        <input
                          type="radio"
                          name="visibility"
                          value="private"
                          checked={state.visibility === "private"}
                          onChange={() =>
                            setState((s) => ({ ...s, visibility: "private" }))
                          }
                        />
                        <span style={{ marginLeft: 6 }}>Private</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="visibility"
                          value="public"
                          checked={state.visibility === "public"}
                          onChange={() =>
                            setState((s) => ({ ...s, visibility: "public" }))
                          }
                        />
                        <span style={{ marginLeft: 6 }}>Public</span>
                      </label>
                    </div>
                  </Stack>
                ) : null}

                <Divider />
                <label>
                  <input
                    type="checkbox"
                    checked={state.push}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setState((s) => ({
                        ...s,
                        push: Boolean(e.target.checked),
                      }))
                    }
                  />
                  <span style={{ marginLeft: 8 }}>Push initial commit</span>
                </label>
                <label>
                  <div>Auth label (optional)</div>
                  <input
                    type="text"
                    placeholder="work"
                    value={state.authLabel}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setState((s) => ({ ...s, authLabel: e.target.value }))
                    }
                  />
                </label>
              </Box>

              <Box>
                <Typography variant="subtitle">Command preview</Typography>
                <pre style={{ margin: 0 }}>
                  <code>{preview}</code>
                </pre>
              </Box>

              <Stack sx={{ gap: "0.5rem" }}>
                <Button disabled={submitting} onClick={onSubmit}>
                  {submitting ? "Creating…" : "Create Workspace"}
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </Box>
    </Surface>
  );
}
