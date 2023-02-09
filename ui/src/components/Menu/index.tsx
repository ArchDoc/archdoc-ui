import { ReactElement, ReactNode } from 'react';
import './index.css';

interface Props {
    children: ReactNode
}

export const Menu = ({children}: Props) => {
    return (
        <div className="Menu">
            <div className="logo">
              <img src="/logo.png" />
            </div>
    
            {children}
          </div>
    );
}