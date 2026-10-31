import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ContentSize } from "azure-devops-ui/Callout";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { Spinner } from "azure-devops-ui/Components/Spinner/Spinner";
import { SpinnerSize } from "azure-devops-ui/Components/Spinner/Spinner.Props";
import { TextField } from "azure-devops-ui/Components/TextField/TextField";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { IMenuProps, MenuItemType } from "azure-devops-ui/Menu";
import { DialogBody } from "../../../../components/DialogBody/DialogBody";
import { InlineText } from "../../../../components/InlineText/InlineText";
import {
  ButtonGroupBase,
  DialogBase,
  MenuButtonBase,
  MessageCardBase,
  asComponent,
} from "../../../../components/uiCompat";
import {
  createRepositoryPreset,
  deleteRepositoryPreset,
  getRepositoryPresets,
  MAX_REPOSITORY_PRESETS,
  MAX_REPOSITORY_PRESET_NAME_LENGTH,
  RepositoryPreset,
  sortRepositoryPresets,
  updateRepositoryPreset,
} from "../../../../services/repositoryPresets";
import { getErrorMessage } from "../../../../utils/errorUtils";
import { isSelectable, RepoRow, ScopeState } from "../../hooks/useProjectRepos";
import { RepositoryDropdown } from "../RepositoryDropdown/RepositoryDropdown";
import "./RepositoryPresets.css";

const SpinnerBase = asComponent(Spinner);
const TextFieldBase = asComponent(TextField);

interface PresetDraft {
  id: string | null;
  name: string;
  repositoryIds: string[];
  unavailableRepositoryIds: string[];
}

interface RepositoryPresetDialogProps {
  presets: RepositoryPreset[];
  loading: boolean;
  loadError: string | null;
  repoRows: RepoRow[];
  selectedRepoIds: string[];
  onDismiss: () => void;
  onReload: () => void;
  onCreate: (name: string, repositoryIds: string[]) => Promise<void>;
  onUpdate: (id: string, name: string, repositoryIds: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function RepositoryPresetDialog({
  presets,
  loading,
  loadError,
  repoRows,
  selectedRepoIds,
  onDismiss,
  onReload,
  onCreate,
  onUpdate,
  onDelete,
}: RepositoryPresetDialogProps) {
  const [draft, setDraft] = useState<PresetDraft | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectableIds = useMemo(
    () => new Set(repoRows.filter(isSelectable).map((row) => row.target.repositoryId)),
    [repoRows],
  );

  const startNewPreset = (): void => {
    setDraft({
      id: null,
      name: "",
      repositoryIds: selectedRepoIds.filter((id) => selectableIds.has(id)),
      unavailableRepositoryIds: [],
    });
    setPendingDeleteId(null);
    setActionError(null);
  };

  const startEditingPreset = (preset: RepositoryPreset): void => {
    setDraft({
      id: preset.id,
      name: preset.name,
      repositoryIds: preset.repositoryIds.filter((id) => selectableIds.has(id)),
      unavailableRepositoryIds: preset.repositoryIds.filter((id) => !selectableIds.has(id)),
    });
    setPendingDeleteId(null);
    setActionError(null);
  };

  const saveDraft = async (): Promise<void> => {
    if (!draft) {
      return;
    }

    const name = draft.name.trim();
    if (!name) {
      setActionError("Enter a preset name.");
      return;
    }

    const repositoryIds = [...new Set([...draft.repositoryIds, ...draft.unavailableRepositoryIds])];
    setBusy(true);
    setActionError(null);
    try {
      if (draft.id === null) {
        await onCreate(name, repositoryIds);
      } else {
        await onUpdate(draft.id, name, repositoryIds);
      }
      setDraft(null);
    } catch (err) {
      setActionError(`Failed to save preset: ${getErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (id: string): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await onDelete(id);
      setPendingDeleteId(null);
    } catch (err) {
      setActionError(`Failed to delete preset: ${getErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const availableCount = (preset: RepositoryPreset): number =>
    preset.repositoryIds.filter((id) => selectableIds.has(id)).length;

  return (
    <DialogBase
      titleProps={{ text: "Manage Repository Presets", size: TitleSize.Large }}
      showCloseButton
      onDismiss={onDismiss}
      contentSize={ContentSize.Auto}
      className="custom-scrollbar"
    >
      <DialogBody className="bc-repository-presets-dialog">
        {loading ? (
          <div className="bc-repository-presets-loading">
            <SpinnerBase size={SpinnerSize.large} label="Loading presets..." ariaLabel="Loading presets" />
          </div>
        ) : null}
        {loadError ? (
          <MessageCardBase
            severity={MessageCardSeverity.Error}
            role="alert"
            buttonProps={[{ text: "Retry", onClick: onReload }]}
          >
            Failed to load repository presets: {loadError}
          </MessageCardBase>
        ) : null}
        {actionError ? (
          <MessageCardBase severity={MessageCardSeverity.Error} role="alert">
            {actionError}
          </MessageCardBase>
        ) : null}
        {!loading && !loadError ? (
          <>
            <div className="bc-repository-presets-toolbar">
              <Button
                text="New preset"
                onClick={startNewPreset}
                disabled={busy || draft !== null || presets.length >= MAX_REPOSITORY_PRESETS}
              />
              <InlineText tone="muted">
                {presets.length} / {MAX_REPOSITORY_PRESETS} presets
              </InlineText>
            </div>

            {presets.length === 0 ? (
              <p className="bc-repository-presets-empty">No presets yet. Create one to save a repository selection.</p>
            ) : (
              <div className="bc-repository-preset-list">
                {presets.map((preset) => (
                  <article className="bc-repository-preset-entry" key={preset.id}>
                    <div className="bc-repository-preset-entry-main">
                      <strong>{preset.name}</strong>
                      <span className="secondary-text">
                        {availableCount(preset)} selectable / {preset.repositoryIds.length} saved repositories
                      </span>
                    </div>
                    <div className="bc-repository-preset-entry-actions">
                      {pendingDeleteId === preset.id ? (
                        <>
                          <Button
                            text="Confirm delete"
                            danger
                            onClick={() => void confirmDelete(preset.id)}
                            disabled={busy}
                          />
                          <Button
                            text="Cancel"
                            onClick={() => setPendingDeleteId(null)}
                            disabled={busy}
                          />
                        </>
                      ) : (
                        <>
                          <Button
                            text="Edit"
                            ariaLabel={`Edit preset ${preset.name}`}
                            onClick={() => startEditingPreset(preset)}
                            disabled={busy || draft !== null}
                          />
                          <Button
                            text="Delete"
                            ariaLabel={`Delete preset ${preset.name}`}
                            onClick={() => {
                              setPendingDeleteId(preset.id);
                              setActionError(null);
                            }}
                            disabled={busy || draft !== null}
                          />
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {draft ? (
              <div className="bc-repository-preset-form">
                <TextFieldBase
                  label="Preset name"
                  ariaLabel="Preset name"
                  value={draft.name}
                  maxLength={MAX_REPOSITORY_PRESET_NAME_LENGTH}
                  required
                  disabled={busy}
                  onChange={(_event, value) => {
                    setDraft((current) => (current ? { ...current, name: value } : current));
                  }}
                />
                <RepositoryDropdown
                  repoRows={repoRows}
                  selectedRepoIds={draft.repositoryIds}
                  onSelectionChange={(repositoryIds) => {
                    setDraft((current) => (current ? { ...current, repositoryIds } : current));
                  }}
                  disabled={busy}
                  ariaLabel="Repositories in preset"
                />
                <ButtonGroupBase className="flex-center">
                  <Button
                    text="Select all"
                    onClick={() => {
                      setDraft((current) =>
                        current ? { ...current, repositoryIds: [...selectableIds] } : current,
                      );
                    }}
                    disabled={busy || selectableIds.size === 0 || draft.repositoryIds.length === selectableIds.size}
                  />
                  <Button
                    text="Clear selection"
                    onClick={() => {
                      setDraft((current) => (current ? { ...current, repositoryIds: [] } : current));
                    }}
                    disabled={busy || draft.repositoryIds.length === 0}
                  />
                </ButtonGroupBase>
                {draft.unavailableRepositoryIds.length > 0 ? (
                  <p className="bc-repository-preset-unavailable">
                    {draft.unavailableRepositoryIds.length} saved{" "}
                    {draft.unavailableRepositoryIds.length === 1 ? "repository is" : "repositories are"} not
                    selectable now. They will remain saved but will not be selected until access returns.
                  </p>
                ) : null}
                <div className="bc-repository-preset-form-actions">
                  <Button
                    text={draft.id === null ? "Create preset" : "Save changes"}
                    primary
                    onClick={() => void saveDraft()}
                    disabled={busy}
                  />
                  <Button
                    text="Cancel"
                    onClick={() => {
                      setDraft(null);
                      setActionError(null);
                    }}
                    disabled={busy}
                  />
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </DialogBody>
    </DialogBase>
  );
}

/** Selects a saved repository list or opens preset management. */
export function RepositoryPresets({ scope }: { scope: ScopeState }) {
  const [presets, setPresets] = useState<RepositoryPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setPresets(await getRepositoryPresets());
    } catch (err) {
      setPresets([]);
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createPreset = useCallback(async (name: string, repositoryIds: string[]): Promise<void> => {
    const created = await createRepositoryPreset(name, repositoryIds);
    setPresets((current) => sortRepositoryPresets([...current, created]));
  }, []);

  const updatePreset = useCallback(
    async (id: string, name: string, repositoryIds: string[]): Promise<void> => {
      const updated = await updateRepositoryPreset(id, name, repositoryIds);
      setPresets((current) => sortRepositoryPresets(current.map((preset) => (preset.id === id ? updated : preset))));
    },
    [],
  );

  const deletePreset = useCallback(async (id: string): Promise<void> => {
    await deleteRepositoryPreset(id);
    setPresets((current) => current.filter((preset) => preset.id !== id));
  }, []);

  const menuProps = useMemo<IMenuProps>(
    () => ({
      id: "bc-repository-presets-menu",
      items: [
        ...presets.map((preset) => ({ id: `preset-${preset.id}`, text: preset.name })),
        ...(presets.length > 0 ? [{ id: "preset-divider", itemType: MenuItemType.Divider }] : []),
        { id: "manage-presets", text: "Manage presets", iconProps: { iconName: "Settings" } },
      ],
    }),
    [presets],
  );

  return (
    <div className="bc-repository-presets">
      {loadError ? (
        <MessageCardBase
          severity={MessageCardSeverity.Error}
          role="alert"
          buttonProps={[{ text: "Retry", onClick: () => void reload() }]}
        >
          Failed to load repository presets: {loadError}
        </MessageCardBase>
      ) : null}
      <MenuButtonBase
        text="Preset"
        ariaLabel="Select a repository preset"
        disabled={scope.loading}
        contextualMenuProps={{
          menuProps,
          onActivate: (item) => {
            if (item.id === "manage-presets") {
              setDialogOpen(true);
              return;
            }
            const preset = presets.find((candidate) => item.id === `preset-${candidate.id}`);
            if (preset) {
              scope.selectRepos(preset.repositoryIds);
            }
          },
        }}
      />
      {dialogOpen ? (
        <RepositoryPresetDialog
          presets={presets}
          loading={loading}
          loadError={loadError}
          repoRows={scope.repoRows}
          selectedRepoIds={scope.selectedRepoIds}
          onDismiss={() => setDialogOpen(false)}
          onReload={() => void reload()}
          onCreate={createPreset}
          onUpdate={updatePreset}
          onDelete={deletePreset}
        />
      ) : null}
    </div>
  );
}
