import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EnvironmentStatus, SetupScreen } from "./SetupScreen";
import { Writer } from "./Writer";
import "./App.css";

function App() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(
    null,
  );
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    invoke<EnvironmentStatus>("check_environment")
      .then((status) => {
        if (mounted) {
          setEnvironment(status);
        }
      })
      .catch((error) => {
        if (mounted) {
          setCheckError(String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  function handleEnvironment(status: EnvironmentStatus) {
    setEnvironment(status);
    setCheckError(null);
  }

  if (environment?.ready) {
    return <Writer />;
  }

  if (!environment && !checkError) {
    return (
      <main className="app-shell">
        <p role="status">Checking tools</p>
      </main>
    );
  }

  return (
    <SetupScreen
      environment={environment}
      checkError={checkError}
      onEnvironment={handleEnvironment}
    />
  );
}

export default App;
