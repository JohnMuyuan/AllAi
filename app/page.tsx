import { ChatApp } from "@/components/ChatApp";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { LangProvider } from "@/components/I18n";
import { TitleBar } from "@/components/TitleBar";

export default function Home() {
  return (
    <LangProvider>
      <ConfirmProvider>
        <div className="flex h-full flex-col">
          <TitleBar />
          <div className="min-h-0 flex-1">
            <ChatApp />
          </div>
        </div>
      </ConfirmProvider>
    </LangProvider>
  );
}
