import { Github, RightC } from '@icon-park/react';
import Icon from '@icon-park/react/es/all';
import { ArchDocComponent } from '../../models/ArchdocModel2';
import { UsageSummary } from '../UsageSummary';
import './index.css';

interface Props {
    archdocComponent: ArchDocComponent | null,
    onSelectComponent: (component: string | null) => void
}

export const DetailSidebar = ({archdocComponent, onSelectComponent}: Props) => {
    if (archdocComponent === null) {
        return (<></>)
    }

    console.log(archdocComponent.repository);

    const tags = archdocComponent?.tags.map((tag, idx) => <span key={idx} className='tag'>{tag}</span>);

    const repoistoryUrl = (archdocComponent) ? archdocComponent.repository : "#";

    const getIconTypeFromUrl = (url: string | null): string => {
        if (url && url.includes("github.com")) {
            return "github";
        }

        return "earth";
    }

    const repositorySection = <div>
        <h3>Repository</h3>
        <div className='link'><Icon type={getIconTypeFromUrl(repoistoryUrl)} theme="filled" size="22" fill="#333" strokeWidth={4}/><a href={(repoistoryUrl) ? repoistoryUrl : "#"} target='_blank'>{repoistoryUrl}</a></div>
    </div>

    const consumerList = archdocComponent?.consumers.map((x, idx) => 
        <UsageSummary 
            key={idx}
            component={x.componentId} 
            description={x.description} 
            onComponentClick={onSelectComponent} />
    )

    const consumerSection = <div>
        <h3>Consumers</h3>
        {consumerList}
    </div>

    const dependentList = archdocComponent?.dependencies.map((x, idx) => 
        <UsageSummary 
            key={idx}
            component={x.componentId} 
            description={x.description} 
            onComponentClick={onSelectComponent} />
    )

    const dependencySection = <div>
        <h3>Dependencies</h3>
        {dependentList}
    </div>

    return (
        <div className="DetailSidebar">
            <div className='details'>
                <div className='component-header'>
                    
                    <RightC theme="filled" size="38" fill="#E9E9E9" strokeWidth={4} onClick={() => onSelectComponent(null)}/>
                    <div className='component-name'>
                        <h1>{(archdocComponent) ? archdocComponent.name : "?"}</h1>
                        <h3>Component</h3>
                    </div>
                </div>
                <div>
                    {tags}
                </div>
                <div>
                    <h3>Description</h3>
                    <p>{(archdocComponent) ? archdocComponent.description : "?"}</p>
                </div>
                {(archdocComponent.repository && archdocComponent.repository !== null) ? repositorySection : <></>}
                {(consumerList.length > 0) ? consumerSection : <></>}
                {(dependentList.length > 0) ? dependencySection : <></>}
                <div>
                    <h3>Documentation</h3>
                    <p>{(archdocComponent) ? archdocComponent.documentation : "?"}</p>
                </div>
            </div>
        </div>
    )
}