import React from "react";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { Spinner } from "azure-devops-ui/Components/Spinner/Spinner";
import { SpinnerSize } from "azure-devops-ui/Components/Spinner/Spinner.Props";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { HeaderBase, MessageCardBase, PageBase, asComponent } from "../../components/uiCompat";
import { useBulkRun } from "./hooks/useBulkRun";
import { useDefinitionDraft } from "./hooks/useDefinitionDraft";
import { useProjectRepos } from "./hooks/useProjectRepos";
import { useSdkReady } from "./hooks/useSdkReady";
import { DefinitionCard } from "./components/DefinitionCard/DefinitionCard";
import { RunSection } from "./components/RunSection/RunSection";
import { ScopeCard } from "./components/ScopeCard/ScopeCard";
import "./CollectionApp.css";

const SpinnerBase = asComponent(Spinner);

/** The collection hub page. It wires the state hooks together and lays out the cards; each card owns its UI. */
export function CollectionApp() {
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
      />

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

        <RunSection definition={draft.definition} targets={scope.targets} run={run} />
      </div>
    </PageBase>
  );
}
