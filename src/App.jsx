import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import SignupForm from "./components/auth/SignupForm";
import LoginForm from "./components/auth/LoginForm";
import Dashboard from "./pages/Dashboard";
import Train from "./pages/Train";
import VoiceProfile from "./pages/VoiceProfile";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/signup" />} />

        <Route path="/signup" element={<SignupForm />} />
        <Route path="/login" element={<LoginForm />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/train" element={<Train />} />
        <Route path="/voice-profile" element={<VoiceProfile />} />
      </Routes>
    </Router>
  );
}

export default App;
