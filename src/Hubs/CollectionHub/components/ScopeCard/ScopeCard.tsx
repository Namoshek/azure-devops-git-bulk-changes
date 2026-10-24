import React from "react";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { Spinner } from "azure-devops-ui/Components/Spinner/Spinner";
import { SpinnerSize } from "azure-devops-ui/Components/Spinner/Spinner.Props";
import { ButtonGroupBase, CardBase, FormItemBase, MessageCardBase, asComponent } from "../../../../components/uiCompat";
import { InlineText } from "../../../../components/InlineText/InlineText";
import { CardBody } from "../../../../components/CardBody/CardBody";
import { ScopeState } from "../../hooks/useProjectRepos";
import { RepoDropdown } from "../RepoDropdown/RepoDropdown";
import "./ScopeCard.css";

const SpinnerBase = asComponent(Spinner);

/** Which repositories the change is applied to. */
export function ScopeCard({ scope }: { scope: ScopeState }) {
  const selectableCount = scope.repoRows.filter((row) => row.target.repositoryId).length;
  const failedProjects = scope.repoRows.filter((row) => row.error);

  return (
    <CardBase
      titleProps={{ text: "Scope", size: TitleSize.Medium }}
      headerDescriptionProps={{ text: "Repositories the change is applied to." }}
    >
      <CardBody className="bc-scope-body">
        {scope.error ? (
          <MessageCardBase
            severity={MessageCardSeverity.Error}
            role="alert"
            buttonProps={[{ text: "Retry", onClick: scope.reload }]}
          >
            Could not load repositories: {scope.error}
          </MessageCardBase>
        ) : null}

        {failedProjects.length > 0 ? (
          <MessageCardBase severity={MessageCardSeverity.Warning} role="alert">
            Some projects could not be listed:{" "}
            {failedProjects.map((row) => `${row.target.projectName || row.target.projectId}: ${row.error}`).join("; ")}
          </MessageCardBase>
        ) : null}

        <FormItemBase label="Repositories">
          {scope.loading ? (
            <SpinnerBase size={SpinnerSize.small} label="Loading repositories…" ariaLabel="Loading repositories" />
          ) : (
            <RepoDropdown scope={scope} />
          )}
        </FormItemBase>

        <ButtonGroupBase>
          <Button text="Select all" onClick={() => scope.setAllRepos(true)} disabled={selectableCount === 0} />
          <Button text="Clear" onClick={() => scope.setAllRepos(false)} disabled={scope.selectedRepoIds.length === 0} />
        </ButtonGroupBase>

        <InlineText tone="muted">
          {scope.selectedRepoIds.length} of {selectableCount} repositories selected
        </InlineText>
      </CardBody>
    </CardBase>
  );
}
