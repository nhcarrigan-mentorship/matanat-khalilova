import React from "react";
import { useState, useEffect } from "react";

const Train = () => {
  const [phrases, setPhrases] = useState(null);

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
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Training Phrases</h1>
      <ol>
        {phrases.map((phrase) => (
          <li key={phrase.id}>{phrase.text}</li>
        ))}
      </ol>
    </div>
  );
};

export default Train;
