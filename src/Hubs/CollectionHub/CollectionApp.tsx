import React, { useState } from "react";
import { GITHUB_URL } from "./components/HelpDialog/HelpDialog";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { Spinner } from "azure-devops-ui/Components/Spinner/Spinner";
import { SpinnerSize } from "azure-devops-ui/Components/Spinner/Spinner.Props";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { MenuItemType } from "azure-devops-ui/Menu";
import { HeaderBase, MessageCardBase, PageBase, asComponent } from "../../components/uiCompat";
import { useBulkRun } from "./hooks/useBulkRun";
import { useDefinitionDraft } from "./hooks/useDefinitionDraft";
import { useProjectRepos } from "./hooks/useProjectRepos";
import { useSdkReady } from "./hooks/useSdkReady";
import { DefinitionCard } from "./components/DefinitionCard/DefinitionCard";
import { RunSection } from "./components/RunSection/RunSection";
import { ScopeCard } from "./components/ScopeCard/ScopeCard";
import { HelpDialog } from "./components/HelpDialog/HelpDialog";
import { HistoryDialog } from "./components/HistoryDialog/HistoryDialog";
import "./CollectionApp.css";

const SpinnerBase = asComponent(Spinner);

/** The collection hub page. It wires the state hooks together and lays out the cards; each card owns its UI. */
export function CollectionApp() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sdk = useSdkReady();
  const draft = useDefinitionDraft();
  const scope = useProjectRepos();
  const run = useBulkRun();

  if (!sdk.ready) {
    return (
      <PageBase>
        <div className="page-content page-content-top flex-grow flex-row justify-center">
          <SpinnerBase size={SpinnerSize.large} label="Loading…" />
        </div>
      </PageBase>
    );
  }

  return (
    <PageBase>
      <HeaderBase
        title="Git Bulk Changes"
        titleSize={TitleSize.Large}
        description="Preview and apply the same change across many Git repositories, within the projects and repositories you can access."
        commandBarItems={[
          {
            id: "history",
            text: "History",
            ariaLabel: "Bulk change history",
            iconProps: { iconName: "History" },
            subtle: true,
            important: true,
            tooltipProps: { text: "History" },
            onActivate: () => setHistoryOpen(true),
          },
          {
            id: "help",
            text: "Help",
            ariaLabel: "Help and project links",
            iconProps: { iconName: "Unknown" },
            subtle: true,
            important: true,
            tooltipProps: { text: "Help" },
            subMenuProps: {
              id: "bc-help-menu",
              items: [
                {
                  id: "how-it-works",
                  text: "How it works",
                  iconProps: { iconName: "Unknown" },
                  onActivate: () => setHelpOpen(true),
                },
                { id: "divider", itemType: MenuItemType.Divider },
                {
                  id: "github",
                  text: "View on GitHub",
                  iconProps: { iconName: "NavigateExternalInline" },
                  href: GITHUB_URL,
                  target: "_blank",
                  rel: "noopener noreferrer",
                },
              ],
            },
          },
        ]}
      />
      {helpOpen ? <HelpDialog onDismiss={() => setHelpOpen(false)} /> : null}
      {historyOpen ? <HistoryDialog onDismiss={() => setHistoryOpen(false)} /> : null}

      <div className="page-content page-content-top bc-page">
        {sdk.error ? (
          <MessageCardBase severity={MessageCardSeverity.Error} role="alert">
            Failed to load the extension context: {sdk.error}
          </MessageCardBase>
        ) : null}

        <div className="bc-columns">
          <div className="bc-column-main">
            <DefinitionCard
              yamlText={draft.yamlText}
              parsed={draft.parsed}
              disabled={run.busy}
              onYamlChange={draft.setYamlText}
              onLoadExample={draft.loadExample}
              onAddOperation={draft.addOperation}
            />
          </div>
          <div className="bc-column-side">
            <ScopeCard scope={scope} />
          </div>
        </div>

        <RunSection definition={draft.definition} yamlText={draft.yamlText} targets={scope.targets} run={run} />
      </div>
    </PageBase>
  );
}
