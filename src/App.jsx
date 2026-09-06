import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { supabase } from "./supabase";
import reefLeft from "./assets/reef-left.png";
import reefBottom from "./assets/reef-bottom.png";
import reefRight from "./assets/reef-right.png";

import fish1 from "./assets/fish_01.png";
import fish2 from "./assets/fish_02.png";
import jelly from "./assets/jelly.png";
import bubble1 from "./assets/bubble_01.png";
import bubble2 from "./assets/bubble_02.png";
import coralPurple from "./assets/coralPurple.png";
import seaweed from "./assets/seaweed.png";
import star from "./assets/star.png"
import school from "./assets/school.png"

const DEFAULT_TOPICS = [
  { id: crypto.randomUUID(), name: "Multilingual", icon: "🐟" },
  { id: crypto.randomUUID(), name: "Reasoning", icon: "🐚" },
  { id: crypto.randomUUID(), name: "Probing", icon: "🪸" },
  { id: crypto.randomUUID(), name: "Teaching", icon: "⭐" },
  { id: crypto.randomUUID(), name: "Fun", icon: "🌿" },
];

const DECORATIONS = [
  { src: fish1, className: "fish-one" },
  { src: fish1, className: "fish-three" },
  { src: fish2, className: "fish-two" },
  { src: fish2, className: "fish-four" },
  { src: school, className: "fish-school-one" },
  { src: school, className: "fish-school-two" },

  { src: jelly, className: "jelly-one" },
  { src: jelly, className: "jelly-two" },

  { src: bubble1, className: "bubble-one" },
  { src: bubble1, className: "bubble-three" },
  { src: bubble2, className: "bubble-two" },
  { src: bubble2, className: "bubble-four" },

  { src: coralPurple, className: "coral-one" },
  { src: coralPurple, className: "coral-two" },

  { src: seaweed, className: "seaweed-one" },
  { src: seaweed, className: "seaweed-two" },

  { src: star, className: "star-one" },
  { src: star, className: "star-two" },

];

function loadData(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function newPaper(topicId = null) {
  return {
    id: crypto.randomUUID(),
    title: "Untitled paper",
    authors: "",
    venue: "",
    year: "",
    url: "",
    note: "",
    isRead: false,
    isUseful: false,
    topicIds: topicId ? [topicId] : [],
    createdAt: Date.now(),
  };
}


async function fetchPaperMetadata(input) {
  const { data, error } =
    await supabase.functions.invoke(
      "metadata",
      {
        body: {
          url: input,
        },
      }
    );

  if (error) {
    console.error(
      "Metadata Edge Function error:",
      error
    );

    let message = error.message;

    if (error.context) {
      try {
        const body =
          await error.context.clone().json();

        console.error(
          "Edge Function response body:",
          body
        );

        if (body?.error) {
          message = body.error;
        }
      } catch (parseError) {
        console.error(
          "Could not parse Edge Function response:",
          parseError
        );
      }
    }

    throw new Error(message);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}



export default function App() {
  const [topics, setTopics] = useState(() =>
    loadData("paperreef-topics", DEFAULT_TOPICS)
  );

  const [papers, setPapers] = useState(() =>
    loadData("paperreef-papers", [])
  );

  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [selectedPaperId, setSelectedPaperId] = useState(null);

  const [search, setSearch] = useState("");

  const [showPaperModal, setShowPaperModal] = useState(false);

  const [editingTopic, setEditingTopic] = useState(null);
  const [topicPopoverPos, setTopicPopoverPos] = useState(null);

  const [draggedTopicId, setDraggedTopicId] = useState(null);
  const [dropIndicator, setDropIndicator] = useState(null);

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("local");

  const hasLoadedRemote = useRef(false);

  useEffect(() => {
    localStorage.setItem("paperreef-topics", JSON.stringify(topics));
  }, [topics]);

  useEffect(() => {
    localStorage.setItem("paperreef-papers", JSON.stringify(papers));
  }, [papers]);

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setUser(session?.user ?? null);
      setAuthLoading(false);

      if (window.location.hash.includes("access_token")) {
            window.history.replaceState(
              {},
              document.title,
              window.location.pathname
            );
          }

    }

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);


  useEffect(() => {
    if (!user) {
      hasLoadedRemote.current = false;
      setSyncStatus("local");
      return;
    }

    async function syncInitialData() {
      setSyncStatus("loading");

      const remote =
        await loadRemoteData(user.id);

      if (remote) {
        if (Array.isArray(remote.topics)) {
          setTopics(remote.topics);
        }

        if (Array.isArray(remote.papers)) {
          setPapers(remote.papers);
        }
      } else {
        // 서버에 아직 데이터가 없으면
        // 현재 local 데이터를 최초 업로드
        await saveRemoteData(
          user.id,
          topics,
          papers
        );
      }

      hasLoadedRemote.current = true;
      setSyncStatus("synced");
    }

    syncInitialData();
  }, [user]);


  useEffect(() => {
    if (!user) return;
    if (!hasLoadedRemote.current) return;

    setSyncStatus("saving");

    const timer = setTimeout(async () => {
      try {
        await saveRemoteData(
          user.id,
          topics,
          papers
        );

        setSyncStatus("synced");
      } catch {
        setSyncStatus("error");
      }
    }, 800);

    return () => clearTimeout(timer);

  }, [topics, papers, user]);


  const selectedPaper = papers.find(
    (paper) => paper.id === selectedPaperId
  );

  const filteredPapers = useMemo(() => {
    return papers
      .filter((paper) => {
        const topicMatch =
          !selectedTopicId || paper.topicIds.includes(selectedTopicId);

        const q = search.trim().toLowerCase();

        const searchMatch =
          !q ||
          paper.title.toLowerCase().includes(q) ||
          paper.authors.toLowerCase().includes(q) ||
          paper.venue.toLowerCase().includes(q) ||
          paper.note.toLowerCase().includes(q);

        return topicMatch && searchMatch;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [papers, selectedTopicId, search]);



  async function signInWithGoogle() {
    const { error } =
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
        },
      });

    if (error) {
      console.error(error);
      alert("Google login failed.");
    }
  }

  async function signOut() {
    const { error } =
      await supabase.auth.signOut();

    if (error) {
      console.error(error);
    }
  }


  async function loadRemoteData(userId) {
    const { data, error } = await supabase
      .from("paper_reef_data")
      .select("data")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Remote load failed:", error);
      return null;
    }

    return data?.data ?? null;
  }


  async function saveRemoteData(userId, topics, papers) {
    const { error } = await supabase
      .from("paper_reef_data")
      .upsert({
        user_id: userId,

        data: {
          version: 1,
          topics,
          papers,
        },

        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error("Remote save failed:", error);
      throw error;
    }
  }

  function updatePaper(id, patch) {
    setPapers((prev) =>
      prev.map((paper) =>
        paper.id === id ? { ...paper, ...patch } : paper
      )
    );
  }

  function addPaper() {
    setShowPaperModal(true);
  }

  function deletePaper(id) {
    setPapers((prev) => prev.filter((paper) => paper.id !== id));

    if (selectedPaperId === id) {
      setSelectedPaperId(null);
    }
  }

  function exportData() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      topics,
      papers,
    };

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `paper-reef-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);

        if (
          !Array.isArray(data.topics) ||
          !Array.isArray(data.papers)
        ) {
          throw new Error("Invalid backup format");
        }

        const confirmed = window.confirm(
          "현재 Paper Reef 데이터를 이 백업으로 교체할까?"
        );

        if (!confirmed) return;

        setTopics(data.topics);
        setPapers(data.papers);

        setSelectedTopicId(null);
        setSelectedPaperId(null);

        alert("Import complete 🐟");
      } catch (error) {
        console.error(error);
        alert("이 파일은 Paper Reef backup이 아닌 것 같아.");
      }
    };

    reader.readAsText(file);
  }

  function addTopic() {
    const name = window.prompt("Topic name");

    if (!name?.trim()) return;

    const icon = window.prompt("Icon", "🐠") || "🐠";

    setTopics((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        icon,
      },
    ]);
  }


  function moveTopic(draggedId, targetId, position) {
    if (draggedId === targetId) return;

    setTopics((prev) => {
      const next = [...prev];

      const fromIndex = next.findIndex(
        (topic) => topic.id === draggedId
      );

      const targetIndex = next.findIndex(
        (topic) => topic.id === targetId
      );

      if (fromIndex === -1 || targetIndex === -1) {
        return prev;
      }

      const [moved] = next.splice(fromIndex, 1);

      let insertIndex = next.findIndex(
        (topic) => topic.id === targetId
      );

      if (position === "after") {
        insertIndex += 1;
      }

      next.splice(insertIndex, 0, moved);

      return next;
    });
  }


  function openTopicEditor(topic, event) {
    const rect = event.currentTarget.getBoundingClientRect();

    setEditingTopic(topic);

    setTopicPopoverPos({
      top: rect.bottom + 6,
      left: rect.left,
    });
  }

  function saveTopic(id, patch) {
    setTopics((prev) =>
      prev.map((topic) =>
        topic.id === id
          ? { ...topic, ...patch }
          : topic
      )
    );

    setEditingTopic(null);
  }

  function deleteTopic(topicId) {
    const topic = topics.find((t) => t.id === topicId);

    if (!window.confirm(`Delete "${topic?.name}"?`)) return;

    setTopics((prev) => prev.filter((topic) => topic.id !== topicId));

    setPapers((prev) =>
      prev.map((paper) => ({
        ...paper,
        topicIds: paper.topicIds.filter((id) => id !== topicId),
      }))
    );

    if (selectedTopicId === topicId) {
      setSelectedTopicId(null);
    }
  }

  return (
    <div className="app-shell">

      {/* decorative bubbles */}
      <div className="bubble bubble-1" />
      <div className="bubble bubble-2" />
      <div className="bubble bubble-3" />

      <TopicSidebar
        topics={topics}
        selectedTopicId={selectedTopicId}
        onSelectTopic={setSelectedTopicId}
        onAddTopic={addTopic}
        onEditTopic={openTopicEditor}
        onDeleteTopic={deleteTopic}
        draggedTopicId={draggedTopicId}
        setDraggedTopicId={setDraggedTopicId}
        dropIndicator={dropIndicator}
        setDropIndicator={setDropIndicator}
        onMoveTopic={moveTopic}
        onExport={exportData}
        onImport={importData}

        user={user}
        authLoading={authLoading}
        syncStatus={syncStatus}
        onGoogleLogin={signInWithGoogle}
        onSignOut={signOut}

      />

      <PaperList
        papers={filteredPapers}
        selectedPaperId={selectedPaperId}
        search={search}
        setSearch={setSearch}
        onSelectPaper={setSelectedPaperId}
        onAddPaper={addPaper}
      />

      <PaperDetail
        paper={selectedPaper}
        topics={topics}
        updatePaper={updatePaper}
        deletePaper={deletePaper}
        exportBibtex={exportBibtex}
      />

      <img
        src={reefLeft}
        className="reef-image reef-left"
        alt=""
        aria-hidden="true"
      />

      <img
        src={reefBottom}
        className="reef-image reef-bottom"
        alt=""
        aria-hidden="true"
      />

      <img
        src={reefRight}
        className="reef-image reef-right"
        alt=""
        aria-hidden="true"
      />

{/*      {DECORATIONS.map((item, index) => (
        <img
          key={index}
          src={item.src}
          className={`reef-decoration-sprite ${item.className}`}
          alt=""
          aria-hidden="true"
        />
      ))}*/}

      <div className="aquarium-decorations">
        <img
          src={fish1}
          className="decor fish fish-1"
          alt=""
        />

        <img
          src={fish2}
          className="decor fish fish-2"
          alt=""
        />

        <img
          src={school}
          className="decor fish fish-school"
          alt=""
        />

        <img
          src={jelly}
          className="decor jelly jelly-1"
          alt=""
        />

        <img
          src={star}
          className="decor star star-1"
          alt=""
        />

        <img
          src={bubble1}
          className="decor bubbles bubbles-1"
          alt=""
        />

        <img
          src={bubble2}
          className="decor bubbles bubbles-2"
          alt=""
        />

        <img
          src={coralPurple}
          className="decor coral coral-1"
          alt=""
        />

        <img
          src={seaweed}
          className="decor seaweed seaweed-1"
          alt=""
        />

      </div>

      {showPaperModal && (
        <PaperModal
          topics={topics}
          initialTopicId={selectedTopicId}
          onClose={() => setShowPaperModal(false)}
          onSave={(paper) => {
            setPapers((prev) => [paper, ...prev]);
            setSelectedPaperId(paper.id);
            setShowPaperModal(false);
          }}
        />
      )}

      {editingTopic && topicPopoverPos && (
        <TopicPopover
          topic={editingTopic}
          position={topicPopoverPos}
          onClose={() => setEditingTopic(null)}
          onSave={saveTopic}
        />
      )}

    </div>
  );
}

function TopicSidebar({
  topics,
  selectedTopicId,
  onSelectTopic,
  onAddTopic,
  onEditTopic,
  onDeleteTopic,
  draggedTopicId,
  setDraggedTopicId,
  dropIndicator,
  setDropIndicator,
  onMoveTopic,
  onExport,
  onImport,

  user,
  authLoading,
  syncStatus,
  onGoogleLogin,
  onSignOut,

}) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <img
          src={`${import.meta.env.BASE_URL}coral-favicon.png`}
          className="logo-icon"
          alt=""
          aria-hidden="true"
        />
        <div className="logo-text">
          <h1 className="pixel-font">Paper Reef</h1>
          <span>tiny research archive</span>
        </div>
      </div>


      <div className="sync-panel">
        {authLoading ? (
          <span className="sync-message">
            checking...
          </span>

        ) : user ? (
          <>
            <div className="sync-info">
              <div className="sync-user">
                <span
                  className={`sync-dot sync-${syncStatus}`}
                >
                  ●
                </span>

                <span className="sync-status">
                  {syncStatus === "saving"
                    ? "Saving..."
                    : syncStatus === "synced"
                    ? "Synced"
                    : syncStatus === "error"
                    ? "Sync error"
                    : "Connected"}
                </span>
              </div>

              <div
                className="sync-account"
                title={user.user_metadata?.full_name || user.email}
              >
                {user.user_metadata?.full_name || user.email}
              </div>
            </div>

            <button
              className="sync-button"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            className="google-login-button"
            onClick={onGoogleLogin}
          >
            Google sync
          </button>
        )}
      </div>

      <div className="data-tools">
        <button onClick={onExport}>
          ↥ Export
        </button>

        <label className="import-button">
          ↧ Import

          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              onImport(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>


      <div className="sidebar-title-row">
        <span className="sidebar-title pixel-font">Topics</span>

        <button
          className="tiny-button"
          onClick={onAddTopic}
          title="Add topic"
        >
          ＋
        </button>
      </div>


      <div className="topic-list">

        <div
          className={`topic-row ${
            selectedTopicId === null ? "active" : ""
          }`}
        >
          <button
            className="topic-main"
            onClick={() => onSelectTopic(null)}
          >
            <span className="topic-icon">📄</span>
            <span>All Papers</span>
          </button>
        </div>

        {topics.map((topic) => {
          const showBefore =
            dropIndicator?.topicId === topic.id &&
            dropIndicator?.position === "before";

          const showAfter =
            dropIndicator?.topicId === topic.id &&
            dropIndicator?.position === "after";

          return (
            <div
              key={topic.id}

              className={`topic-row ${
                selectedTopicId === topic.id ? "active" : ""
              } ${
                draggedTopicId === topic.id ? "dragging" : ""
              } ${
                showBefore ? "drop-before" : ""
              } ${
                showAfter ? "drop-after" : ""
              }`}

              draggable

              onDragStart={(event) => {
                setDraggedTopicId(topic.id);

                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "text/plain",
                  topic.id
                );
              }}

              onDragOver={(event) => {
                event.preventDefault();

                if (draggedTopicId === topic.id) {
                  setDropIndicator(null);
                  return;
                }

                const rect =
                  event.currentTarget.getBoundingClientRect();

                const midpoint =
                  rect.top + rect.height / 2;

                const position =
                  event.clientY < midpoint
                    ? "before"
                    : "after";

                setDropIndicator({
                  topicId: topic.id,
                  position,
                });
              }}

              onDrop={(event) => {
                event.preventDefault();

                const draggedId =
                  event.dataTransfer.getData("text/plain");

                if (
                  dropIndicator &&
                  draggedId !== topic.id
                ) {
                  onMoveTopic(
                    draggedId,
                    topic.id,
                    dropIndicator.position
                  );
                }

                setDraggedTopicId(null);
                setDropIndicator(null);
              }}

              onDragEnd={() => {
                setDraggedTopicId(null);
                setDropIndicator(null);
              }}
            >
              <div
                className="topic-drag-handle"
                title="Drag to reorder"
              >
                ⠿
              </div>

              <button
                className="topic-main"
                onClick={() =>
                  onSelectTopic(topic.id)
                }
              >
                <span className="topic-icon">
                  {topic.icon}
                </span>

                <span>{topic.name}</span>
              </button>

              <div className="topic-actions">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditTopic(topic, event);
                  }}
                  title="Edit"
                >
                  ✎
                </button>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteTopic(topic.id);
                  }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

      </div>

      <div className="sidebar-bottom-copy">
        good papers
        <br />
        take you further.
      </div>


    </aside>
  );
}

function PaperList({
  papers,
  selectedPaperId,
  search,
  setSearch,
  onSelectPaper,
  onAddPaper,
}) {
  return (
    <main className="paper-column">
      <div className="search-bar">
        <div className="search-input-wrapper">
          <span>⌕</span>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search papers..."
          />
        </div>

        <button
          className="add-paper-button"
          onClick={onAddPaper}
          title="Add paper"
        >
          ＋
        </button>
      </div>

      <div className="paper-list">
        {papers.length === 0 ? (
          <div className="empty-list">
            <img
              src={fish2}
              className="empty-list-fish"
              alt=""
            />
            <strong>No papers here yet.</strong>
            <span>Add one before it swims away.</span>
          </div>
        ) : (
          papers.map((paper) => (
            <button
              key={paper.id}
              className={`paper-card ${
                paper.id === selectedPaperId ? "selected" : ""
              }`}
              onClick={() => onSelectPaper(paper.id)}
            >
              <div className="paper-doc-icon">
                <span />
                <span />
                <span />
              </div>

              <div className="paper-card-content">
                <strong>{paper.title}</strong>

                <div className="paper-meta">
                  {paper.venue && (
                    <div className="paper-venue">
                      {formatVenueShort(paper.venue, paper.year)}
                    </div>
                  )}

                  {paper.authors && (
                    <div className="paper-authors">
                      {formatAuthorsShort(paper.authors)}
                    </div>
                  )}
                </div>
              </div>

              <div className="paper-badges">
                <span
                  className={`paper-badge ${paper.isRead ? "active" : ""}`}
                  title="Read"
                >
                  ✓
                </span>

                <span
                  className={`paper-badge useful ${paper.isUseful ? "active" : ""}`}
                  title="Useful"
                >
                  ★
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </main>
  );
}

function PaperDetail({
  paper,
  topics,
  updatePaper,
  deletePaper,
  exportBibtex,
}) {
  if (!paper) {
    return (
      <section className="detail-panel empty-detail">
        <div className="empty-state">
          <div className="empty-fish-wrap">
            <img
              src={fish1}
              className="empty-fish"
              alt=""
              aria-hidden="true"
            />

            <span className="empty-bubble bubble-small" />
            <span className="empty-bubble bubble-big" />
          </div>

          <h2 className="pixel-font">Select a paper</h2>
          <p>Pick something from the reef.</p>
        </div>
      </section>
    );
  }

  function toggleTopic(topicId) {
    const exists = paper.topicIds.includes(topicId);

    updatePaper(paper.id, {
      topicIds: exists
        ? paper.topicIds.filter((id) => id !== topicId)
        : [...paper.topicIds, topicId],
    });
  }

  return (
    <section className="detail-panel">
      <div className="detail-scroll">

        <input
          className="detail-title"
          value={paper.title}
          onChange={(event) =>
            updatePaper(paper.id, {
              title: event.target.value,
            })
          }
        />

        <div className="detail-meta-summary">
          <span>
            {formatVenueShort(paper.venue, paper.year)}
          </span>

          <span>
            {formatAuthorsShort(paper.authors)}
          </span>
        </div>

        <div className="link-buttons">
          <button
            className="primary-link"
            disabled={!paper.url}
            onClick={() =>
              window.open(paper.url, "_blank")
            }
          >
            ↗ Open
          </button>

          <button
            onClick={() => exportBibtex(paper)}
          >
            Cite
          </button>
          
        </div>

        <div className="link-fields">
          <input
            placeholder="Paper URL"
            value={paper.url}
            onChange={(event) =>
              updatePaper(paper.id, {
                url: event.target.value,
              })
            }
          />

        </div>

        <div className="divider" />

        <section>
          <h3>
            <span>🐟</span>
            Status
          </h3>

          <div className="status-row">
            <Toggle
              label="Read"
              checked={paper.isRead}
              onChange={(value) =>
                updatePaper(paper.id, {
                  isRead: value,
                })
              }
            />

            <Toggle
              label="Useful"
              checked={paper.isUseful}
              onChange={(value) =>
                updatePaper(paper.id, {
                  isUseful: value,
                })
              }
            />
          </div>
        </section>

        <div className="divider" />

        <section>
          <h3>Topics</h3>

          <div className="topic-chip-list">
            {topics.map((topic) => {
              const selected =
                paper.topicIds.includes(topic.id);

              return (
                <button
                  key={topic.id}
                  className={`topic-chip ${
                    selected ? "selected" : ""
                  }`}
                  onClick={() =>
                    toggleTopic(topic.id)
                  }
                >
                  {topic.icon} {topic.name}
                </button>
              );
            })}
          </div>
        </section>

        <div className="divider" />

        <section>
          <h3>My Notes</h3>

          <textarea
            value={paper.note}
            placeholder="Why did I save this?"
            onChange={(event) =>
              updatePaper(paper.id, {
                note: event.target.value,
              })
            }
          />
        </section>

        <button
          className="delete-paper-button"
          onClick={() => {
            if (
              window.confirm(
                `Delete "${paper.title}"?`
              )
            ) {
              deletePaper(paper.id);
            }
          }}
        >
          Delete paper
        </button>
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-card">
      <button
        type="button"
        className={`toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>

      <span>{label}</span>
    </label>
  );
}

function PaperModal({
  topics,
  initialTopicId,
  onClose,
  onSave,
}) {
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [venue, setVenue] = useState("");
  const [year, setYear] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState("");

  const [topicIds, setTopicIds] = useState(
    initialTopicId ? [initialTopicId] : []
  );

  function toggleTopic(topicId) {
    setTopicIds((prev) =>
      prev.includes(topicId)
        ? prev.filter((id) => id !== topicId)
        : [...prev, topicId]
    );
  }

  async function handleFetchMetadata() {
    if (!url.trim()) {
      setFetchMessage(
        "먼저 논문 URL을 넣어줘."
      );
      return;
    }

    setIsFetching(true);
    setFetchMessage("");

    try {
      const metadata =
        await fetchPaperMetadata(
          url.trim()
        );

      if (metadata.title) {
        setTitle(metadata.title);
      }

      if (metadata.authors) {
        setAuthors(metadata.authors);
      }

      if (metadata.venue) {
        setVenue(metadata.venue);
      }

      if (metadata.year) {
        setYear(metadata.year);
      }

      if (metadata.url) {
        setUrl(metadata.url);
      }

      const sourceNames = {
        neurips: "NeurIPS",
        acl: "ACL Anthology",
        arxiv: "arXiv",
        crossref: "Crossref",
        generic: "web page",
      };

      const source =
        sourceNames[metadata.source] ||
        metadata.source;

      setFetchMessage(
        `✓ Found via ${source}`
      );

    } catch (error) {
      console.error(error);

      setFetchMessage(
        `못 찾았어: ${error.message}`
      );

    } finally {
      setIsFetching(false);
    }
  }


  function handleSave() {
    if (!title.trim()) return;

    const paper = {
      id: crypto.randomUUID(),
      title: title.trim(),
      authors: authors.trim(),
      venue: venue.trim(),
      year: year.trim(),
      url: url.trim(),
      note: note.trim(),
      isRead: false,
      isUseful: false,
      topicIds,
      createdAt: Date.now(),
    };

    onSave(paper);
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
    >
      <div
        className="paper-modal"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <div className="modal-header">
          <div>
            <span className="modal-fish">🐟</span>
            <h2>Add Paper</h2>
          </div>

          <button
            className="modal-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <label className="form-field">
          <span>Title</span>

          <input
            autoFocus
            value={title}
            onChange={(event) =>
              setTitle(event.target.value)
            }
            placeholder="Paper title"
          />
        </label>

        <label className="form-field">
          <span>Authors</span>

          <input
            value={authors}
            onChange={(event) =>
              setAuthors(event.target.value)
            }
            placeholder="Author names"
          />
        </label>

        <div className="form-row">
          <label className="form-field">
            <span>Venue</span>

            <input
              value={venue}
              onChange={(event) =>
                setVenue(event.target.value)
              }
              placeholder="EMNLP"
            />
          </label>

          <label className="form-field year-field">
            <span>Year</span>

            <input
              value={year}
              onChange={(event) =>
                setYear(event.target.value)
              }
              placeholder="2026"
            />
          </label>
        </div>

        <div className="form-field">
          <span>Paper URL / DOI</span>

          <div className="metadata-url-row">
            <input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setFetchMessage("");
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  handleFetchMetadata();
                }
              }}
              placeholder="https://doi.org/10...."
            />

            <button
              type="button"
              className="fetch-button"
              disabled={!url.trim() || isFetching}
              onClick={handleFetchMetadata}
            >
              {isFetching ? (
                <>
                  <span className="spinner" />
                  Fetching
                </>
              ) : (
                <>
                  ✦ Fetch
                </>
              )}
            </button>
          </div>

          {fetchMessage && (
            <div
              className={`fetch-message ${
                fetchMessage.startsWith("✓")
                  ? "success"
                  : ""
              }`}
            >
              {fetchMessage}
            </div>
          )}
        </div>

        <div className="form-field">
          <span>Topics</span>

          <div className="modal-topic-list">
            {topics.map((topic) => {
              const selected =
                topicIds.includes(topic.id);

              return (
                <button
                  key={topic.id}
                  type="button"
                  className={`topic-chip ${
                    selected ? "selected" : ""
                  }`}
                  onClick={() =>
                    toggleTopic(topic.id)
                  }
                >
                  {topic.icon} {topic.name}
                </button>
              );
            })}
          </div>
        </div>

        <label className="form-field">
          <span>Quick note</span>

          <textarea
            className="modal-note"
            value={note}
            onChange={(event) =>
              setNote(event.target.value)
            }
            placeholder="Why did I save this?"
          />
        </label>

        <div className="modal-actions">
          <button
            className="secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="save-button"
            disabled={!title.trim()}
            onClick={handleSave}
          >
            Add Paper
          </button>
        </div>

        <div className="modal-pixel-coral">
          🫧 · 🪸 · 🐚
        </div>
      </div>
    </div>
  );
}


function TopicPopover({
  topic,
  position,
  onClose,
  onSave,
}) {
  const [name, setName] = useState(topic.name);
  const [icon, setIcon] = useState(topic.icon);

  function handleSave() {
    if (!name.trim()) return;

    onSave(topic.id, {
      name: name.trim(),
      icon: icon.trim() || "🐟",
    });
  }

  return (
    <>
      <div
        className="popover-dismiss"
        onMouseDown={onClose}
      />

      <div
        className="topic-popover"
        style={{
          top: position.top,
          left: position.left,
        }}
      >
        <div className="popover-title">
          Edit Topic
        </div>

        <label>
          <span>Name</span>

          <input
            autoFocus
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
          />
        </label>

        <label>
          <span>Icon</span>

          <input
            className="icon-input"
            value={icon}
            onChange={(event) =>
              setIcon(event.target.value)
            }
          />
        </label>

        <div className="popover-actions">
          <button
            className="secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="save-button small"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}


function makeBibtexKey(paper) {
  const firstAuthor = paper.authors
    ?.split(",")[0]
    ?.trim()
    ?.split(" ")
    ?.at(-1)
    ?.toLowerCase()
    ?.replace(/[^a-z0-9]/g, "") || "paper";

  const year = paper.year || "nd";

  const firstTitleWord = paper.title
    ?.split(/\s+/)
    ?.find((word) => word.length > 3)
    ?.toLowerCase()
    ?.replace(/[^a-z0-9]/g, "") || "untitled";

  return `${firstAuthor}${year}${firstTitleWord}`;
}

function paperToBibtex(paper) {
  const key = makeBibtexKey(paper);

  const fields = [
    `  title = {${paper.title || ""}}`,
    paper.authors
      ? `  author = {${paper.authors
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .join(" and ")}}`
      : null,
    paper.venue
      ? `  booktitle = {${paper.venue}}`
      : null,
    paper.year
      ? `  year = {${paper.year}}`
      : null,
    paper.url
      ? `  url = {${paper.url}}`
      : null,
  ].filter(Boolean);

  return `@inproceedings{${key},\n${fields.join(",\n")}\n}`;
}

function exportBibtex(paper) {
  const bibtex = paperToBibtex(paper);

  const blob = new Blob(
    [bibtex],
    { type: "text/plain;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${makeBibtexKey(paper)}.bib`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}


function formatVenueShort(venue, year) {
  if (!venue) return "";

  const v = venue.toLowerCase();

  // ACL
  if (
    v.includes("annual meeting of the association for computational linguistics")
  ) {
    const track = v.includes("findings")
      ? "Findings"
      : "Main";

    return `ACL${year ? ` ${year}` : ""} (${track})`;
  }

  // EMNLP
  if (
    v.includes("empirical methods in natural language processing")
  ) {
    const track = v.includes("findings")
      ? "Findings"
      : "Main";

    return `EMNLP${year ? ` ${year}` : ""} (${track})`;
  }

  // NAACL
  if (
    v.includes("north american chapter of the association for computational linguistics")
  ) {
    const track = v.includes("findings")
      ? "Findings"
      : "Main";

    return `NAACL${year ? ` ${year}` : ""} (${track})`;
  }

  // EACL
  if (
    v.includes("european chapter of the association for computational linguistics")
  ) {
    const track = v.includes("findings")
      ? "Findings"
      : "Main";

    return `EACL${year ? ` ${year}` : ""} (${track})`;
  }

  // CoNLL
  if (v.includes("computational natural language learning")) {
    return `CoNLL${year ? ` ${year}` : ""}`;
  }

  // NeurIPS
  if (
    v.includes("neural information processing systems") ||
    v.includes("neurips")
  ) {
    return `NeurIPS${year ? ` ${year}` : ""}`;
  }

  // ICML
  if (v.includes("international conference on machine learning")) {
    return `ICML${year ? ` ${year}` : ""}`;
  }

  // ICLR
  if (v.includes("international conference on learning representations")) {
    return `ICLR${year ? ` ${year}` : ""}`;
  }

  // 모르는 venue는 원래 이름 유지
  return venue;
}


function formatAuthorsShort(authors) {
  if (!authors) return "";

  const names = authors
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.length === 0) return "";

  const firstAuthor = names[0];

  // "Qiming Li" → "Li"
  const surname =
    firstAuthor.split(/\s+/).at(-1) || firstAuthor;

  if (names.length === 1) {
    return surname;
  }

  return `${surname} et al.`;
}