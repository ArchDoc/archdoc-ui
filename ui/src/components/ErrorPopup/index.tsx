import React, { useState } from 'react';

interface ErrorPopupProps {
  errorMessage: string;
}

export const ErrorPopup = ({ errorMessage }: ErrorPopupProps) => {
  const [isVisible, setIsVisible] = useState(true);

  const handleClose = () => {
    setIsVisible(false);
  };

  return (
    <div>
      {isVisible ? (
      <div style={{ 
        background: '#ff5858', 
        color: '#fff',
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        position: "absolute",
        width: "calc(100% - 80px)",
        zIndex: 1
      }}>
        <p style={{ margin: 0, padding: "20px" }}>{errorMessage}</p>
        <button style={{
            background: '#fff',
            border: 'none',
            borderRadius: '5px',
            color: '#333',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '5px 10px',
            margin: "20px"
          }} onClick={handleClose}>Close</button>
      </div>
    ) : null}
    </div>

  );
};
