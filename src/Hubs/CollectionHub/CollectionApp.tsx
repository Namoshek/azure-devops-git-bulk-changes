import React, { useState, useEffect } from "react";
import * as SDK from "azure-devops-extension-sdk";
import { Page as PageBase } from "azure-devops-ui/Components/Page/Page";
const Page = PageBase as React.ComponentType<React.ComponentProps<typeof PageBase> & { children?: React.ReactNode }>;
import { Header } from "azure-devops-ui/Components/Header/Header";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { Spinner } from "azure-devops-ui/Components/Spinner/Spinner";
import { SpinnerSize } from "azure-devops-ui/Components/Spinner/Spinner.Props";
import { MessageCard } from "azure-devops-ui/Components/MessageCard/MessageCard";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { getErrorMessage } from "../../utils/errorUtils";

export function CollectionApp() {
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        await SDK.ready();
      } catch (err) {
        setInitError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, []);

  if (loading) {
    return (
      <Page>
        <div className="page-content page-content-top flex-grow flex-row justify-center">
          <Spinner size={SpinnerSize.large} label="Loading…" />
        </div>
      </Page>
    );
  }

  if (initError) {
    return (
      <Page>
        <div className="page-content page-content-top">
          <MessageCard severity={MessageCardSeverity.Error}>Failed to load settings: {initError}</MessageCard>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <Header title="Git Bulk Changes" titleSize={TitleSize.Large} />
      <div className="page-content page-content-top rhythm-vertical-16">Extension Content</div>
    </Page>
  );
}
