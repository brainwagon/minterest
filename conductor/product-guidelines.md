# Product Guidelines: minterest

## 1. UX Design Principles
- **Direct Manipulation:** Users should interact with content as directly as possible. Dragging, clicking, and dropping elements should be the primary method of organization, rather than navigating complex menus.
- **Low Friction Gathering:** The application must prioritize ease of use for adding new content. Whether it's pasting a link, dragging an image, or creating a note, the "time to add" should be minimized to keep the user focused on their creative flow.
- **Interaction Feedback:** Every action (e.g., successful upload, drag-and-drop reordering) should provide immediate, subtle visual or haptic feedback to the user.

## 2. Branding & Visual Identity
- **Invisible Interface:** The UI is a canvas for the user's content. It should be "transparent" and stay out of the way, using a minimalist aesthetic with plenty of white space and standard system fonts.
- **Focus on Content:** Use subtle borders, soft shadows, and neutral colors to distinguish between cards without distracting from the user's images and links.
- **Consistent Icons:** Utilize inline SVG icons (e.g., Heroicons) for a clean, consistent, and scalable look that feels modern and lightweight.

## 3. Prose & Tone
- **Friendly & Encouraging:** Use a warm, helpful voice in all user-facing text. The goal is to make the user feel comfortable and supported while organizing their ideas.
- **Task-Oriented:** Keep instructions and labels concise and focused on the user's immediate goal. Avoid overly technical jargon where possible.
- **Supportive Feedback:** When a task is completed, use friendly language to acknowledge the success (e.g., "Your new topic is ready!").

## 4. Error Handling & Accessibility
- **Informative & Remedial:** When errors occur, provide clear, detailed explanations of what went wrong and actionable steps for how the user can resolve the issue. Avoid cryptic error codes.
- **Graceful Failures:** If a feature (like auto-favicon generation) fails, the application should degrade gracefully and allow the user to continue their work with minimal interruption.
- **Accessibility:** Ensure all interactive elements are keyboard-accessible and provide appropriate ARIA labels for screen readers. Maintain high contrast for readability.
