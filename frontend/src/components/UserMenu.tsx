import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function UserMenu() {
  const { user, logout, authEnabled, isAdmin } = useAuth();
  const [showMenu, setShowMenu] = useState(false);

  if (!authEnabled || !user) {
    return null;
  }

  return (
    <div className="user-menu">
      <button className="user-menu-trigger" onClick={() => setShowMenu(!showMenu)}>
        {user.picture ? (
          <img src={user.picture} alt="" className="user-avatar" />
        ) : (
          <div className="user-avatar-placeholder" aria-hidden="true">{user.name.charAt(0)}</div>
        )}
        <span className="user-name">{user.name}</span>
      </button>

      {showMenu && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>

          {isAdmin && (
            <>
              <Link
                to="/process-audit"
                className="user-menu-item"
                onClick={() => setShowMenu(false)}
              >
                Process Audit
              </Link>
              <Link
                to="/admin/deployment-templates"
                className="user-menu-item"
                onClick={() => setShowMenu(false)}
              >
                Deployment Templates
              </Link>
            </>
          )}

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
