import React from "react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./Train.css";

const Train = () => {
  const [phrases, setPhrases] = useState(null);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [user, setUser] = useState(null);
  const [isFinished, setIsFinished] = useState(false);
  const navigate = useNavigate();

  const handleNext = () => {
    setPhraseIndex((prevIndex) =>
      prevIndex + 1 < phrases.length ? prevIndex + 1 : 0,
    );
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/auth/me", {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json();

        if (response.ok) {
          setUser(data.user);
        }
      } catch (error) {
        console.error("Failed to fetch user data", error); // eslint-disable-line no-console
      }
    };
    fetchUser();
  }, []);

  const handleFinish = () => {
    setIsFinished(true);
  };

  useEffect(() => {
    const fetchPhrases = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/phrases", {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json();
        if (response.ok) {
          setPhrases(data.phrases);
        } else {
          console.error("Failed to fetch phrases", data.message); // eslint-disable-line no-console
        }
      } catch (error) {
        console.error("Failed to fetch phrases", error); // eslint-disable-line no-console
      }
    };
    fetchPhrases();
  }, []);

  if (!phrases) {
    return <div>Loading phrases...</div>;
  }

  return (
    <div className="train-container" aria-live="polite">
      {isFinished ? (
        <div className="success-message">
          <h2>Fantastic work, {user ? user.name : "there"}! ✅</h2>
          <p>You have successfully completed the training session. </p>
          <button
            onClick={() => navigate("/dashboard")}
            className="dashboard-button"
          >
            Back to Dashboard
          </button>
        </div>
      ) : (
        <div className="training-interface">
          <h1>Training Phrases</h1>
          <p className="instructions">
            Record each phrase to personalize your voice model.
          </p>
          <div className="phrase-box">
            <p>
              Phrase {phraseIndex + 1} of {phrases.length}
            </p>
            <p>{phrases[phraseIndex].text}</p>
          </div>
          <button className="record-button">Record 🎤</button>
          <button className="stop-button">Stop ⏹️</button>
          <button
            onClick={
              phraseIndex === phrases.length - 1 ? handleFinish : handleNext
            }
            className="next-button"
          >
            {phraseIndex === phrases.length - 1 ? "Finish ✅" : "Next ➡️"}
          </button>
        </div>
      )}
    </div>
  );
};

export default Train;
