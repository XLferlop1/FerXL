// XL AI · EQ Log front-end
// Shows last ~200 messages for one configured beta conversation

(async function () {
  const betaConfig = window.XL_BETA_CONFIG || {};
  const conversationId = betaConfig.defaultConversationId || "beta_conversation";
  const loading = document.getElementById("loading");
  const container = document.getElementById("logContainer");

  async function loadMessages() {
    try {
      const res = await fetch(`/api/messages?conversation=${encodeURIComponent(conversationId)}`);
      if (!res.ok) {
        throw new Error("Status " + res.status);
      }

      const data = await res.json();

      loading.textContent = "";

      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (!messages.length) {
        container.textContent = "No messages stored yet.";
        return;
      }

      const table = document.createElement("table");

      const thead = document.createElement("thead");
      thead.innerHTML = `
        <tr>
          <th>Time</th>
          <th>Conversation</th>
          <th>User</th>
          <th>Original</th>
          <th>Final</th>
          <th>Emotion</th>
          <th>Intensity</th>
          <th>Pause?</th>
          <th>Used suggestion?</th>
          <th>Action Taken</th>
          <th>Pause Reason</th>
          <th>Risks</th>
          <th>Intent Guess</th>
          <th>Coach Mode</th>
        </tr>
      `;
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      messages.forEach((m) => {
        const tr = document.createElement("tr");

        const created = m.created_at_timestamp || m.created_at || "";
        const timeStr = created ? new Date(created).toLocaleString() : "";

        tr.innerHTML = `
          <td>${timeStr}</td>
          <td>${m.conversation_id || ""}</td>
          <td>${m.user_id || ""}</td>
          <td>${m.original_text || ""}</td>
          <td>${m.final_text || ""}</td>
          <td>${m.pre_send_emotion || ""}</td>
          <td>${
            typeof m.intensity_score === "number"
              ? m.intensity_score.toFixed(2)
              : ""
          }</td>
          <td>${m.was_pause_taken ? "✔" : ""}</td>
          <td>${m.used_suggestion ? "✔" : ""}</td>
          <td>${m.action_taken || ""}</td>
          <td>${m.pause_reason || ""}</td>
          <td>${(m.risks || []).join(', ')}</td>
          <td>${m.intent_guess || ""}</td>
          <td>${m.coach_mode || ""}</td>
        `;
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      container.innerHTML = "";
      container.appendChild(table);
    } catch (err) {
      console.error("[XL AI] eq-log loadMessages error:", err);
      loading.textContent = "Error loading messages. Check console.";
    }
  }

  await loadMessages();
})();                                                           