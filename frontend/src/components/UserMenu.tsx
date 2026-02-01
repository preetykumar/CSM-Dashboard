import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export function UserMenu() {
  const { user, logout, authEnabled } = useAuth();
  const [showMenu, setShowMenu] = useState(false);

  if (!authEnabled || !user) {
    return null;
  }

  return (
    <div className="user-menu">
      <button className="user-menu-trigger" onClick={() => setShowMenu(!showMenu)}>
        {user.picture ? (
          <img src={user.picture} alt={user.name} className="user-avatar" />
        ) : (
          <div className="user-avatar-placeholder">{user.name.charAt(0)}</div>
        )}
        <span className="user-name">{user.name}</span>
      </button>

      {showMenu && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <button
            className="user-menu-item logout-btn"
            onClick={async () => {
              await logout();
              setShowMenu(false);
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
