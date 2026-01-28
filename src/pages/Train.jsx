import React from "react";
import { useState, useEffect } from "react";

const Train = () => {
  const [phrases, setPhrases] = useState(null);
  const [phraseIndex, setPhraseIndex] = useState(0);

  const handleNext = () => {
    setPhraseIndex((prevIndex) =>
      prevIndex + 1 < phrases.length ? prevIndex + 1 : 0,
    );
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
    <div className="train-container">
      <h1>Training Phrases</h1>
      <div className="phrase-box">{phrases[phraseIndex].text}</div>
      <button onClick={handleNext} className="next-button">
        Next
      </button>
    </div>
  );
};

export default Train;
