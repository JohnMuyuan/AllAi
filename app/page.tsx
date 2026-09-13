import { ChatApp } from "@/components/ChatApp";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { LangProvider } from "@/components/I18n";
import { TitleBar } from "@/components/TitleBar";
import { APP_VERSION } from "@/lib/version";

export default function Home() {
  return (
    <LangProvider>
      <ConfirmProvider>
        <div className="flex h-full flex-col">
          <TitleBar version={APP_VERSION} />
          <div className="min-h-0 flex-1">
            <ChatApp />
          </div>
        </div>
      </ConfirmProvider>
    </LangProvider>
  );
}
