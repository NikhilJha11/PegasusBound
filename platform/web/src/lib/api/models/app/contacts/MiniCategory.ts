// Lightweight category shape attached to Contact responses. Matches
// models.MiniCategory on the backend — id, title, color. Used so the UI
// can render category chips without a second lookup against the user's
// full category list.
export default interface MiniCategory {
    id: string;
    title: string;
    color: string;
}
